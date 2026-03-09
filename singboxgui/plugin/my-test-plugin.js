// plugin-my-cfs.js

// 可选：插件基本信息（GUI 会显示在插件列表里，如果没有就用文件名推导）
const info = {
  name: "My CFS 插件",          // 显示名称
  description: "自定义配置修改示例，比如加 DNS 或规则",
  version: "0.1.0",
  author: "你的名字"
};

// 核心钩子：onGenerate（最常用）
// 参数：config 是 GUI 生成的 sing-box 配置对象（JSON 对象）
// 你修改它后，必须返回修改后的 config
const onGenerate = async (config, profile) => {   // profile 是可选的元数据
  console.log("插件被调用了！当前配置：", config);  // 调试用，看日志

  // 示例1：强制关闭日志时间戳
  if (config.log) {
    config.log.timestamp = false;
  }

  // 示例2：添加一个自定义 DNS server
  if (!config.dns) config.dns = {};
  if (!config.dns.servers) config.dns.servers = [];
  config.dns.servers.push({
    tag: "my-google-dns",
    address: "tls://8.8.8.8",
    detour: "direct"  // 或你的 outbound tag
  });

  // 示例3：全局加一条规则（匹配 example.com 走 proxy）
  if (!config.route) config.route = {};
  if (!config.route.rules) config.route.rules = [];
  config.route.rules.push({
    domain: ["example.com", "www.example.com"],
    outbound: "proxy"  // 替换成你的 outbound tag
  });

  return config;  // 必须返回！否则配置不会生效
};

// 可选其他钩子（根据需要加）
const onRun = () => {
  console.log("插件启用/运行时执行一次");
};

const onStartup = () => {
  console.log("GUI 启动时执行");
};

// 导出钩子（关键！GUI 只认这些名字）
// export { onGenerate, onRun, onStartup, info };