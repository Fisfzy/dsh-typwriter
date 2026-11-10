// 圈选画布的全局开关：放在模块态而不是 TypstPreview 的局部 state，为的是
// 「圈选 AI」入口可以常驻在编辑器顶栏——预览没开时点它 = 开预览 + 进圈选，
// 刷新/换会话后按钮不再跟着预览工具栏一起消失。
export const agentCanvas = $state({ armed: false });
