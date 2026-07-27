/**
 * HTTP 登录态检测的解析层回归测试。
 *
 * 样本取自 `Web三平台-HTTP登录态检测改造数据.md` 里已登录 / 未登录的实测对照，
 * 并与 2026-07-27 在真实登录态上抓到的响应形状一致。
 *
 * 这一层最容易「看起来对」而实际误判，所以每个平台都同时断言正反两种样本。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    AUTH_CACHE_TTL_MS,
    describeAuthStatus,
    parseFlowAuth,
    parseGeminiAuth,
    parseJimengAuth,
    parseJimengUserInfo,
    readWizField,
    toBrowserSessionState
} from '../server/services/webhttp/auth.js';

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

const geminiLoggedIn = `<script>window.WIZ_global_data = {"FdrFJe":"-8183032361261999623","S06Grb":"113355779911335577991","SNlM0e":"ADR5zarIzq87goMHcVAfr29tRTpw:1785139739510","cfb2h":"boq_assistant-bard-web-server_20260723.02_p0"};</script>`;

// 无痕未登录：FdrFJe 依然在，但 S06Grb 是空串、没有 SNlM0e。
const geminiLoggedOut = `<script>window.WIZ_global_data = {"FdrFJe":"-1122334455667788990","S06Grb":"","cfb2h":"boq_assistant-bard-web-server_20260723.02_p0"};</script><a href="/ServiceLogin">Sign in</a>`;

test('Gemini 已登录：S06Grb + SNlM0e 同时非空', () => {
    const status = parseGeminiAuth(geminiLoggedIn);
    assert.equal(status.status, 'logged-in');
    assert.equal(status.userId, '113355779911335577991');
    assert.equal(status.source, 'http');
});

test('Gemini 未登录：S06Grb 为空串即判定未登录', () => {
    const status = parseGeminiAuth(geminiLoggedOut);
    assert.equal(status.status, 'logged-out');
    assert.equal(status.reason, 'NO_ACCOUNT_ID');
});

test('Gemini：FdrFJe 绝不能作为登录标志', () => {
    // 这是文档点名的错误实现：未登录页面同样带 FdrFJe，按它判断会把所有访客判成已登录。
    assert.ok(/FdrFJe/.test(geminiLoggedOut), '未登录样本本身必须含 FdrFJe');
    assert.equal(parseGeminiAuth(geminiLoggedOut).status, 'logged-out');

    // 只有 FdrFJe、没有账号信息时同样是未登录。
    assert.equal(parseGeminiAuth('{"FdrFJe":"-123456789"}').status, 'logged-out');
});

test('Gemini：有账号但缺 bootstrap token 判为过期而不是未登录', () => {
    const status = parseGeminiAuth('{"FdrFJe":"-1","S06Grb":"1133557799"}');
    assert.equal(status.status, 'expired');
    assert.equal(status.reason, 'NO_BOOTSTRAP_TOKEN');
});

test('readWizField 区分「空值」与「字段不存在」', () => {
    assert.equal(readWizField('{"S06Grb":""}', 'S06Grb'), '');
    assert.equal(readWizField('{"other":"x"}', 'S06Grb'), null);
    assert.equal(readWizField('{"S06Grb":"abc"}', 'S06Grb'), 'abc');
});

// ---------------------------------------------------------------------------
// 即梦
// ---------------------------------------------------------------------------

const jimengUserInfo = JSON.stringify({
    data: { user_info: { user_id: '9988776655', nick_name: '测试用户', avatar_urls: ['https://cdn/avatar.png'] } }
});
const jimengLoggedIn = `<script>window.__isLogined = true;window.__userInfoStringify = ${JSON.stringify(jimengUserInfo)};window.__userWorkspaces = [];</script>`;
// 未登录页面里同样会出现 sec_uid 字符串（模型配置里带），这正是不能按它判断的原因。
const jimengLoggedOut = '<script>window.__isLogined = false;var cfg={"sec_uid":"anonymous"};</script>';

test('即梦 已登录：__isLogined = true 且能解析出 user_id', () => {
    const status = parseJimengAuth(jimengLoggedIn);
    assert.equal(status.status, 'logged-in');
    assert.equal(status.userId, '9988776655');
    assert.equal(status.name, '测试用户');
    assert.equal(status.avatar, 'https://cdn/avatar.png');
});

test('即梦 未登录：__isLogined = false', () => {
    assert.equal(parseJimengAuth(jimengLoggedOut).status, 'logged-out');
});

test('即梦：不得按 sec_uid 字符串判断登录', () => {
    // 未登录样本里含 sec_uid，若实现写成 html.includes('sec_uid') 这条会翻车。
    assert.ok(/sec_uid/.test(jimengLoggedOut));
    assert.equal(parseJimengAuth(jimengLoggedOut).status, 'logged-out');
});

test('即梦：__isLogined 缺失返回 unknown，不猜', () => {
    const status = parseJimengAuth('<html>完全没有登录标志</html>');
    assert.equal(status.status, 'unknown');
    assert.equal(status.reason, 'LOGIN_FLAG_NOT_FOUND');
});

test('即梦：标记为已登录但用户信息解析失败时返回 unknown', () => {
    const status = parseJimengAuth('<script>window.__isLogined = true;</script>');
    assert.equal(status.status, 'unknown');
    assert.equal(status.reason, 'USER_INFO_UNPARSED');
});

test('parseJimengUserInfo 容忍转义与异常结构', () => {
    assert.equal(parseJimengUserInfo(jimengLoggedIn).userId, '9988776655');
    assert.equal(parseJimengUserInfo('<script>window.__userInfoStringify = "{坏JSON";</script>'), null);
    assert.equal(parseJimengUserInfo('没有这个字段'), null);
});

test('parseJimengUserInfo 按线上真实形状解析（转义引号 + avatar_urls 对象）', () => {
    // 线上样本的实际形状（值已替换为假数据）：整段是被转义一次的 JSON 字符串，
    // 且 avatar_urls 是按尺寸分键的**对象**而不是数组。
    // 之前的实现两处都踩了：惰性匹配在第一个 \\" 就截断；avatar_urls 当数组取 [0]。
    const inner = JSON.stringify({
        ret: '0',
        errmsg: 'success',
        data: {
            updated_sem: false,
            user_info: {
                user_id: '110000000000',
                nick_name: '测试昵称',
                avatar_urls: { avatar_url_large: 'https://cdn.example/large.png' }
            }
        }
    });
    const html = `<script nonce="x">window.__userInfoStringify=${JSON.stringify(inner)};window.__userWorkspaces=[];</script>`;

    const user = parseJimengUserInfo(html);
    assert.ok(user, '真实形状必须能解析出来');
    assert.equal(user.userId, '110000000000');
    assert.equal(user.name, '测试昵称');
    assert.equal(user.avatar, 'https://cdn.example/large.png');

    // 端到端：同一份 HTML 必须判成已登录，而不是 unknown。
    const status = parseJimengAuth(`<script>window.__isLogined=true;</script>${html}`);
    assert.equal(status.status, 'logged-in');
    assert.equal(status.userId, '110000000000');
});

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

test('Flow 已登录：user.email + access_token 齐全', () => {
    const status = parseFlowAuth({
        user: { name: 'Evan', email: 'evan@example.com', image: 'https://cdn/a.png' },
        expires: new Date(Date.now() + 3_600_000).toISOString(),
        access_token: 'ya29.dynamic-token-value'
    });
    assert.equal(status.status, 'logged-in');
    assert.equal(status.email, 'evan@example.com');
    assert.ok(status.expiresAt > Date.now());
});

test('Flow 未登录：NextAuth 返回 {}', () => {
    assert.equal(parseFlowAuth({}).status, 'logged-out');
    assert.equal(parseFlowAuth(null).status, 'logged-out');
});

test('Flow：缺 access_token 不能算已登录', () => {
    // 有用户信息但没 token 时，aisandbox 一定调不通，报「已登录」会误导用户。
    const status = parseFlowAuth({ user: { email: 'a@b.c' }, expires: new Date(Date.now() + 1000).toISOString() });
    assert.equal(status.status, 'logged-out');
});

test('Flow：expires 已过判为 expired 而不是 logged-in', () => {
    const status = parseFlowAuth({
        user: { email: 'a@b.c' },
        expires: new Date(Date.now() - 1000).toISOString(),
        access_token: 'token'
    });
    assert.equal(status.status, 'expired');
    assert.ok(status.expiresAt < Date.now());
});

test('Flow：没有 expires 字段时仍按已登录处理', () => {
    const status = parseFlowAuth({ user: { email: 'a@b.c' }, access_token: 'token' });
    assert.equal(status.status, 'logged-in');
    assert.equal(status.expiresAt, undefined);
});

// ---------------------------------------------------------------------------
// 状态映射
// ---------------------------------------------------------------------------

test('六种状态映射到已有的会话状态词表，不扩充存储', () => {
    assert.equal(toBrowserSessionState('logged-in'), 'authenticated');
    assert.equal(toBrowserSessionState('logged-out'), 'expired');
    assert.equal(toBrowserSessionState('expired'), 'expired');
    assert.equal(toBrowserSessionState('checking'), 'checking');
    assert.equal(toBrowserSessionState('error'), 'unknown');
    assert.equal(toBrowserSessionState('unknown'), 'unknown');
});

test('解析结果不携带任何凭证字段', () => {
    // access_token / cookie 只能留在内存里的 Auth Provider，绝不能进状态对象，
    // 因为它会被写进 API 响应、日志和持久化的会话文件。
    const status = parseFlowAuth({
        user: { email: 'a@b.c' }, expires: new Date(Date.now() + 1000).toISOString(), access_token: 'ya29.secret'
    });
    const serialized = JSON.stringify(status);
    assert.equal(/ya29\.secret/.test(serialized), false);
    assert.equal('access_token' in status, false);
    assert.equal('accessToken' in status, false);

    const gemini = parseGeminiAuth(geminiLoggedIn);
    assert.equal(/ADR5zar/.test(JSON.stringify(gemini)), false, 'SNlM0e 不得出现在状态里');
});

test('缓存 TTL 落在文档建议的 30~120 秒区间', () => {
    assert.ok(AUTH_CACHE_TTL_MS >= 30_000 && AUTH_CACHE_TTL_MS <= 120_000);
});

test('每种状态都有可读文案', () => {
    for (const status of ['logged-in', 'logged-out', 'expired', 'unknown', 'error']) {
        assert.ok(describeAuthStatus({ status }).length > 0);
    }
});

// ---------------------------------------------------------------------------
// 旧方案必须被移除
// ---------------------------------------------------------------------------

test('旧的 DOM / 重定向登录探针已从代码库移除', () => {
    // 文档第 20 节明确要求不再用头像、登录按钮、selector 或 myaccount 重定向判断登录。
    const browserPy = fs.readFileSync(new URL('../server/python/ops_cli/browser.py', import.meta.url), 'utf8');
    assert.equal(/myaccount\.google\.com/.test(browserPy), false, '仍残留 myaccount 重定向探针');
    assert.equal(/probe_google_account_login/.test(browserPy), false, '仍残留 Google 账号重定向探针');
    assert.equal(/_probe_jimeng_login|_probe_flow_login|_probe_gemini_login/.test(browserPy), false, '仍残留旧探针');

    const geminiCommon = fs.readFileSync(
        new URL('../server/python/ops_cli/platforms/_gemini_web_common.py', import.meta.url), 'utf8'
    );
    assert.equal(/myaccount\.google\.com/.test(geminiCommon), false, 'Gemini 仍在用重定向判定登录');
});

test('登录检测不得触发任何生成 / 计费动作', () => {
    // 只看真正会执行的代码：注释里提到某个接口名是在解释「为什么不调它」，不算违规。
    const source = fs.readFileSync(new URL('../server/services/webhttp/auth.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const forbidden of ['aigc_draft/generate', 'batchGenerateImages', 'StreamGenerate',
        'batchAsyncGenerateVideoText', 'workspace/create']) {
        assert.equal(source.includes(forbidden), false, `登录检测里不该出现 ${forbidden}`);
    }
});
