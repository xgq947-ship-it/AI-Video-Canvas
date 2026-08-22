import AppKit
import Combine
import SwiftUI

private enum ProjectLocator {
    private static let launcherRelativePath = "scripts/desktop-launcher.mjs"

    static func resolve() -> URL? {
        let fileManager = FileManager.default

        if let override = ProcessInfo.processInfo.environment["EVAN_PROJECT_ROOT"],
           !override.isEmpty {
            let overrideURL = URL(fileURLWithPath: override, isDirectory: true)
                .standardizedFileURL
            if containsLauncher(overrideURL, fileManager: fileManager) {
                return overrideURL
            }
        }

        // 成品 App 默认放在项目根目录。继续向上查找可同时兼容自定义输出到
        // runtime/controller-build 等项目子目录的开发场景。
        var candidate = Bundle.main.bundleURL
            .deletingLastPathComponent()
            .standardizedFileURL
        while candidate.path != "/" {
            if containsLauncher(candidate, fileManager: fileManager) {
                return candidate
            }
            candidate.deleteLastPathComponent()
        }

        return nil
    }

    private static func containsLauncher(
        _ directory: URL,
        fileManager: FileManager
    ) -> Bool {
        fileManager.fileExists(
            atPath: directory.appendingPathComponent(launcherRelativePath).path
        )
    }
}

private var projectURL: URL? { ProjectLocator.resolve() }
private var projectPath: String? { projectURL?.path }
private var launcherPath: String? {
    projectURL?.appendingPathComponent("scripts/desktop-launcher.mjs").path
}
private var launcherLogURL: URL? {
    projectURL?.appendingPathComponent("runtime/desktop-launcher/launcher.log")
}

private struct LauncherResponse: Decodable, Sendable {
    let status: String
    let pid: Int?
}

private enum ControllerAction: String, Sendable {
    case start
    case restart
    case stop

    var progressText: String {
        switch self {
        case .start: return "正在构建并启动 Evan…"
        case .restart: return "正在安全重启 Evan…"
        case .stop: return "正在关闭 Evan…"
        }
    }
}

private enum RuntimePhase: Equatable {
    case checking
    case running
    case stopped
    case working
    case failed
}

private enum LauncherError: LocalizedError {
    case missingProject
    case missingNode
    case invalidResponse(String)
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingProject:
            return "找不到 AI-Video-Canvas 项目目录"
        case .missingNode:
            return "找不到 Node.js，请先在项目目录完成开发环境安装"
        case .invalidResponse(let detail):
            return "启动器返回了无效结果\(detail.isEmpty ? "" : "：\(detail)")"
        case .commandFailed(let detail):
            return detail
        }
    }
}

private enum Launcher {
    static func run(_ command: String) throws -> LauncherResponse {
        guard let projectPath,
              let launcherPath,
              FileManager.default.fileExists(atPath: launcherPath) else {
            throw LauncherError.missingProject
        }
        guard let nodeURL = resolveNodeExecutable() else {
            throw LauncherError.missingNode
        }

        let process = Process()
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.executableURL = nodeURL
        process.arguments = [launcherPath, command]
        process.currentDirectoryURL = URL(fileURLWithPath: projectPath, isDirectory: true)
        process.standardOutput = outputPipe
        process.standardError = errorPipe

        var environment = ProcessInfo.processInfo.environment
        let inheritedPath = environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        let nodeDirectory = nodeURL.deletingLastPathComponent().path
        environment["PATH"] = "\(nodeDirectory):/opt/homebrew/bin:/usr/local/bin:\(inheritedPath)"
        process.environment = environment

        try process.run()
        process.waitUntilExit()

        let output = String(
            data: outputPipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""
        let error = String(
            data: errorPipe.fileHandleForReading.readDataToEndOfFile(),
            encoding: .utf8
        ) ?? ""

        guard process.terminationStatus == 0 else {
            let detail = error.trimmingCharacters(in: .whitespacesAndNewlines)
            throw LauncherError.commandFailed(detail.isEmpty ? "操作失败，请查看运行日志" : detail)
        }

        guard let line = output
            .split(separator: "\n")
            .last
            .map(String.init),
              let data = line.data(using: .utf8),
              let response = try? JSONDecoder().decode(LauncherResponse.self, from: data) else {
            throw LauncherError.invalidResponse(output.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return response
    }

    private static func resolveNodeExecutable() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let home = environment["HOME"] ?? NSHomeDirectory()
        let inheritedDirectories = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        let candidates = [
            environment["EVAN_NODE_PATH"],
            "\(home)/.local/bin/node",
            "\(home)/.volta/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ].compactMap { $0 } + inheritedDirectories.map { "\($0)/node" }

        for candidate in candidates {
            let standardizedPath = URL(fileURLWithPath: candidate).standardizedFileURL.path
            if FileManager.default.isExecutableFile(atPath: standardizedPath) {
                return URL(fileURLWithPath: standardizedPath)
            }
        }
        return nil
    }
}

@MainActor
private final class ControllerModel: ObservableObject {
    @Published private(set) var phase: RuntimePhase = .checking
    @Published private(set) var pid: Int?
    @Published private(set) var detail = "正在确认 Evan 运行状态…"
    @Published private(set) var activeAction: ControllerAction?

    var isRunning: Bool { phase == .running }
    var isBusy: Bool { activeAction != nil || phase == .checking }

    func refresh() {
        // 操作失败后保留具体原因，直到用户再次操作或重新打开控制器。
        guard activeAction == nil, phase != .failed else { return }
        execute("status", action: nil)
    }

    func perform(_ action: ControllerAction) {
        guard activeAction == nil else { return }
        activeAction = action
        phase = .working
        detail = action.progressText
        execute(action.rawValue, action: action)
    }

    func openProject() {
        guard let projectURL else {
            phase = .failed
            detail = LauncherError.missingProject.localizedDescription
            return
        }
        NSWorkspace.shared.open(projectURL)
    }

    func openLog() {
        guard let projectURL else {
            phase = .failed
            detail = LauncherError.missingProject.localizedDescription
            return
        }
        let manager = FileManager.default
        let logDirectory = projectURL.appendingPathComponent(
            "runtime/desktop-launcher",
            isDirectory: true
        )
        let target = launcherLogURL.flatMap { manager.fileExists(atPath: $0.path) ? $0 : nil }
            ?? logDirectory
        if !manager.fileExists(atPath: target.path) {
            try? manager.createDirectory(
                at: logDirectory,
                withIntermediateDirectories: true
            )
        }
        NSWorkspace.shared.open(target)
    }

    private func execute(_ command: String, action: ControllerAction?) {
        Task {
            do {
                let response = try await Task.detached(priority: .userInitiated) {
                    try Launcher.run(command)
                }.value
                apply(response, action: action)
            } catch {
                activeAction = nil
                phase = .failed
                pid = nil
                detail = error.localizedDescription
            }
        }
    }

    private func apply(_ response: LauncherResponse, action: ControllerAction?) {
        activeAction = nil
        switch response.status {
        case "running", "already_running", "started", "restarted":
            phase = .running
            pid = response.pid
            if response.status == "restarted" {
                detail = "重启完成 · 新进程 PID \(response.pid.map(String.init) ?? "—")"
            } else if response.status == "started" {
                detail = "启动完成 · PID \(response.pid.map(String.init) ?? "—")"
            } else {
                detail = "Evan 正在运行 · PID \(response.pid.map(String.init) ?? "—")"
            }
        case "stopped", "not_running":
            phase = .stopped
            pid = nil
            detail = action == .stop
                ? "Evan 已安全关闭，共用浏览器保持独立管理"
                : "Evan 当前未运行"
        default:
            phase = .failed
            pid = nil
            detail = "未知状态：\(response.status)"
        }
    }
}

private struct VisualEffectBackground: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .underWindowBackground
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

private struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            window.title = "Evan 项目控制器"
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            // 让 SwiftUI 内容真正延伸到交通灯所在的标题栏区域。
            // 仅使用 hiddenTitleBar 仍会为标题栏保留一条不可交互的空白安全区。
            window.styleMask.insert(.fullSizeContentView)
            window.isMovableByWindowBackground = true
            // 固定标题栏底色，避免半透明区域透出控制器后方窗口的文字。
            window.isOpaque = true
            window.backgroundColor = NSColor(
                calibratedRed: 0.05,
                green: 0.06,
                blue: 0.10,
                alpha: 1
            )
            window.center()
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

private struct ActionButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let prominent: Bool
    let disabled: Bool
    let action: () -> Void

    private var backgroundStyle: AnyShapeStyle {
        if prominent {
            return AnyShapeStyle(tint.gradient)
        }
        return AnyShapeStyle(Color.white.opacity(disabled ? 0.035 : 0.075))
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 42)
            .foregroundStyle(disabled ? Color.white.opacity(0.35) : .white)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(backgroundStyle)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.white.opacity(prominent ? 0.16 : 0.10), lineWidth: 1)
                    }
            }
            .shadow(color: prominent && !disabled ? tint.opacity(0.28) : .clear, radius: 16, y: 7)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

private struct ControllerView: View {
    @StateObject private var model = ControllerModel()

    private var appLogo: NSImage? {
        guard let url = Bundle.main.url(forResource: "Evan-logo", withExtension: "png") else {
            return nil
        }
        return NSImage(contentsOf: url)
    }

    private var statusColor: Color {
        switch model.phase {
        case .running: return Color(red: 0.24, green: 0.84, blue: 0.50)
        case .failed: return Color(red: 1.00, green: 0.38, blue: 0.42)
        case .working, .checking: return Color(red: 0.47, green: 0.55, blue: 1.00)
        case .stopped: return Color.white.opacity(0.38)
        }
    }

    private var statusTitle: String {
        switch model.phase {
        case .running: return "运行中"
        case .stopped: return "已停止"
        case .working: return "处理中"
        case .checking: return "检查中"
        case .failed: return "需要处理"
        }
    }

    var body: some View {
        ZStack {
            VisualEffectBackground()
            LinearGradient(
                colors: [
                    Color(red: 0.05, green: 0.06, blue: 0.10).opacity(0.96),
                    Color(red: 0.10, green: 0.07, blue: 0.18).opacity(0.94),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(Color(red: 0.36, green: 0.18, blue: 1.00).opacity(0.22))
                .frame(width: 310, height: 310)
                .blur(radius: 80)
                .offset(x: 220, y: -170)

            VStack(spacing: 20) {
                HStack(spacing: 15) {
                    Group {
                        if let appLogo {
                            Image(nsImage: appLogo)
                                .resizable()
                                .interpolation(.high)
                        } else {
                            Image(systemName: "play.rectangle.fill")
                                .resizable()
                                .scaledToFit()
                                .padding(12)
                                .foregroundStyle(.white)
                                .background(Color.purple.gradient)
                        }
                    }
                    .frame(width: 62, height: 62)
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                    .shadow(color: Color.purple.opacity(0.35), radius: 18, y: 7)

                    VStack(alignment: .leading, spacing: 5) {
                        Text("Evan 项目控制器")
                            .font(.system(size: 23, weight: .bold, design: .rounded))
                        Text("AI Video Canvas · Local Runtime")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.secondary)
                            .tracking(0.7)
                    }
                    Spacer()
                }

                HStack(spacing: 14) {
                    ZStack {
                        Circle()
                            .fill(statusColor.opacity(0.14))
                            .frame(width: 44, height: 44)
                        if model.isBusy {
                            ProgressView()
                                .controlSize(.small)
                                .tint(statusColor)
                        } else {
                            Circle()
                                .fill(statusColor)
                                .frame(width: 10, height: 10)
                                .shadow(color: statusColor.opacity(0.8), radius: 7)
                        }
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(statusTitle)
                            .font(.system(size: 15, weight: .semibold))
                        Text(model.detail)
                            .font(.system(size: 11.5))
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                    Spacer()
                }
                .padding(16)
                .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .stroke(.white.opacity(0.09), lineWidth: 1)
                }

                HStack(spacing: 10) {
                    ActionButton(
                        title: "启动",
                        systemImage: "play.fill",
                        tint: Color(red: 0.36, green: 0.30, blue: 1.00),
                        prominent: !model.isRunning,
                        disabled: model.isBusy || model.isRunning
                    ) { model.perform(.start) }
                    ActionButton(
                        title: "重启",
                        systemImage: "arrow.clockwise",
                        tint: Color(red: 0.48, green: 0.34, blue: 1.00),
                        prominent: model.isRunning,
                        disabled: model.isBusy
                    ) { model.perform(.restart) }
                    ActionButton(
                        title: "关闭",
                        systemImage: "stop.fill",
                        tint: Color(red: 0.92, green: 0.29, blue: 0.36),
                        prominent: false,
                        disabled: model.isBusy || !model.isRunning
                    ) { model.perform(.stop) }
                }

                HStack(spacing: 12) {
                    Button(action: model.openProject) {
                        Label("打开项目", systemImage: "folder")
                    }
                    Button(action: model.openLog) {
                        Label("查看日志", systemImage: "doc.text.magnifyingglass")
                    }
                    Spacer()
                    Text("状态每 3 秒自动刷新")
                        .font(.system(size: 10.5))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.borderless)
                .font(.system(size: 11.5, weight: .medium))
            }
            .padding(.horizontal, 28)
            .padding(.top, 34)
            .padding(.bottom, 24)

            WindowConfigurator()
                .frame(width: 0, height: 0)
        }
        .frame(width: 560, height: 390)
        .ignoresSafeArea(.container, edges: .top)
        .preferredColorScheme(.dark)
        .task {
            model.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                model.refresh()
            }
        }
    }
}

private final class ControllerAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@main
private struct EvanProjectControllerApp: App {
    @NSApplicationDelegateAdaptor(ControllerAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ControllerView()
        }
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
