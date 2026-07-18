import SwiftUI
import AppKit

private enum ServiceState: Equatable {
    case checking
    case stopped
    case running
    case failed(String)
}

@MainActor
private final class LauncherModel: ObservableObject {
    @Published var state: ServiceState = .checking
    @Published var isBusy = false
    @Published var activityText = "正在检查服务"

    nonisolated private static let projectPath = "/Users/dasheng/Desktop/AI漫剧电影/05_TwitCanva视频工作流"
    nonisolated private static let sourcePlist = projectPath + "/launcher/com.dasheng.twitcanva.plist"
    nonisolated private static let installedPlist = "/Users/dasheng/Library/LaunchAgents/com.dasheng.twitcanva.plist"
    nonisolated private static let logPath = "/Users/dasheng/Library/Logs/Evan"
    nonisolated private static let serviceLabel = "com.dasheng.twitcanva"
    nonisolated private static let canvasURL = URL(string: "http://localhost:5173")!

    init() {
        refresh()
    }

    var isRunning: Bool {
        state == .running
    }

    var statusTitle: String {
        switch state {
        case .checking: return "正在检查"
        case .stopped: return "服务未启动"
        case .running: return "服务运行中"
        case .failed: return "操作未完成"
        }
    }

    var statusDetail: String {
        switch state {
        case .checking: return "正在确认本地服务状态"
        case .stopped: return "点击下方按钮即可启动"
        case .running: return "工作台已准备好"
        case .failed(let message): return message
        }
    }

    func refresh() {
        state = .checking
        Task {
            let running = await Task.detached { Self.servicesRunning() }.value
            state = running ? .running : .stopped
        }
    }

    func primaryAction() {
        if isRunning {
            Self.openCanvas()
        } else {
            startAndOpen()
        }
    }

    func startAndOpen() {
        guard !isBusy else { return }
        isBusy = true
        activityText = "正在启动服务"
        Task {
            let result = await Task.detached { Self.startService() }.value
            isBusy = false
            if result.success {
                state = .running
                Self.openCanvas()
            } else {
                state = .failed(result.message)
            }
        }
    }

    func stop() {
        guard !isBusy else { return }
        isBusy = true
        activityText = "正在停止服务"
        Task {
            let stopped = await Task.detached { Self.stopService() }.value
            isBusy = false
            state = stopped ? .stopped : .failed("部分进程仍在运行，请稍后重试")
        }
    }

    func restart() {
        guard !isBusy else { return }
        isBusy = true
        activityText = "正在重启服务"
        Task {
            _ = await Task.detached { Self.stopService() }.value
            let result = await Task.detached { Self.startService() }.value
            isBusy = false
            state = result.success ? .running : .failed(result.message)
        }
    }

    func openProjectFolder() {
        NSWorkspace.shared.open(URL(fileURLWithPath: Self.projectPath))
    }

    func openLogs() {
        _ = Self.shell("mkdir -p \(Self.shellQuote(Self.logPath))")
        NSWorkspace.shared.open(URL(fileURLWithPath: Self.logPath))
    }

    private static func openCanvas() {
        NSWorkspace.shared.open(canvasURL)
    }

    nonisolated private static func servicesRunning() -> Bool {
        let front = shell("curl -fsS --max-time 2 http://localhost:5173 >/dev/null")
        let back = shell("curl -fsS --max-time 2 http://localhost:3001/api/library >/dev/null")
        return front.status == 0 && back.status == 0
    }

    nonisolated private static func startService() -> (success: Bool, message: String) {
        if servicesRunning() { return (true, "") }

        let setup = shell("mkdir -p \(shellQuote(logPath)) \(shellQuote(NSHomeDirectory() + "/Library/LaunchAgents")) && cp \(shellQuote(sourcePlist)) \(shellQuote(installedPlist)) && chmod 644 \(shellQuote(installedPlist))")
        guard setup.status == 0 else {
            return (false, "启动配置安装失败")
        }

        _ = shell("launchctl bootstrap gui/$(id -u) \(shellQuote(installedPlist)) >/dev/null 2>&1 || true")
        let kickstart = shell("launchctl kickstart -k gui/$(id -u)/\(serviceLabel)")
        guard kickstart.status == 0 else {
            return (false, "服务启动失败，可从右上角打开日志")
        }

        for _ in 0..<30 {
            Thread.sleep(forTimeInterval: 0.5)
            if servicesRunning() { return (true, "") }
        }
        return (false, "服务启动超时，可从右上角打开日志")
    }

    nonisolated private static func stopService() -> Bool {
        _ = shell("launchctl bootout gui/$(id -u)/\(serviceLabel) >/dev/null 2>&1 || launchctl bootout gui/$(id -u) \(shellQuote(installedPlist)) >/dev/null 2>&1 || true")
        _ = shell("for port in 5173 3001; do for pid in $(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do kill $pid 2>/dev/null || true; done; done")
        Thread.sleep(forTimeInterval: 0.8)
        return !servicesRunning()
    }

    nonisolated private static func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    @discardableResult
    nonisolated private static func shell(_ command: String) -> (status: Int32, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return (process.terminationStatus, String(decoding: data, as: UTF8.self))
        } catch {
            return (1, error.localizedDescription)
        }
    }
}

private struct LauncherView: View {
    @StateObject private var model = LauncherModel()

    private var statusColor: Color {
        switch model.state {
        case .running: return .green
        case .failed: return .red
        case .checking: return .secondary
        case .stopped: return .orange
        }
    }

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: 22) {
                HStack(alignment: .top, spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [Color(red: 0.33, green: 0.25, blue: 0.96), Color(red: 0.53, green: 0.28, blue: 0.98)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 23, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 52, height: 52)
                    .shadow(color: Color.purple.opacity(0.2), radius: 12, y: 6)

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Evan 工作台")
                            .font(.system(size: 20, weight: .semibold))
                        Text("AI 漫剧创作画布")
                            .font(.system(size: 13))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Menu {
                        Button("重新检查状态", systemImage: "arrow.clockwise") { model.refresh() }
                        if model.isRunning {
                            Button("重启服务", systemImage: "restart") { model.restart() }
                        }
                        Divider()
                        Button("打开项目文件夹", systemImage: "folder") { model.openProjectFolder() }
                        Button("打开运行日志", systemImage: "doc.text.magnifyingglass") { model.openLogs() }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 30, height: 30)
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .disabled(model.isBusy)
                    .help("更多")
                }

                HStack(spacing: 10) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 9, height: 9)
                        .shadow(color: statusColor.opacity(0.5), radius: 4)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.statusTitle)
                            .font(.system(size: 14, weight: .medium))
                        Text(model.statusDetail)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 12, style: .continuous))

                VStack(spacing: 10) {
                    Button(action: model.primaryAction) {
                        HStack(spacing: 8) {
                            if model.isBusy {
                                ProgressView()
                                    .controlSize(.small)
                            } else {
                                Image(systemName: model.isRunning ? "arrow.up.right.square" : "play.fill")
                            }
                            Text(model.isBusy ? model.activityText : (model.isRunning ? "打开工作台" : "启动并打开"))
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(model.isBusy || model.state == .checking)

                    if model.isRunning {
                        Button("停止服务", role: .destructive) { model.stop() }
                            .buttonStyle(.plain)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.secondary)
                            .disabled(model.isBusy)
                    }
                }
            }
            .padding(26)
        }
        .frame(width: 420, height: 300)
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        showWindow()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationShouldSaveSecureApplicationState(_ app: NSApplication) -> Bool {
        false
    }

    func applicationShouldRestoreSecureApplicationState(_ app: NSApplication) -> Bool {
        false
    }

    private func showWindow() {
        if window == nil {
            let contentView = NSHostingView(rootView: LauncherView())
            let newWindow = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 420, height: 300),
                styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
                backing: .buffered,
                defer: false
            )
            newWindow.title = "Evan工作台"
            newWindow.contentView = contentView
            newWindow.titlebarAppearsTransparent = true
            newWindow.titleVisibility = .hidden
            newWindow.isMovableByWindowBackground = true
            newWindow.isReleasedWhenClosed = false
            newWindow.standardWindowButton(.zoomButton)?.isHidden = true
            newWindow.center()
            window = newWindow
        }

        window?.center()
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
private enum TwitCanvaLauncherMain {
    private static let appDelegate = AppDelegate()

    static func main() {
        let app = NSApplication.shared
        app.delegate = appDelegate
        app.setActivationPolicy(.regular)
        app.finishLaunching()
        app.run()
    }
}
