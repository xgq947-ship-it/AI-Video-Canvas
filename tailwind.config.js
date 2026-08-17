/**
 * Tailwind 构建期配置。
 *
 * 这个项目原本在 index.html 里挂 https://cdn.tailwindcss.com（Play CDN）。
 * 那是官方标注只供开发用的运行时编译版本：桌面应用一旦断网、CDN 被墙或者
 * 首屏还没拉到，整个界面就退化成浏览器默认样式。改成构建期生成本地 CSS。
 *
 * 版本刻意锁在 v3，与 Play CDN 提供的一致；v4 改了默认色板与间距，换过去
 * 会让全局样式发生肉眼可见的漂移。
 */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
    './shared/**/*.{js,ts}',
  ],
  theme: { extend: {} },
  plugins: [],
};
