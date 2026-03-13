/* 节点 IP 检测插件 */
const BASE_DIR = 'data/third/plugin-ip-checker'
const jsonFiles = await Plugins.ReadDir(`${BASE_DIR}`);

// const FILE_NAME = saveJsonPath.value;
// const DETECTION_FILE = PATH + FILE_NAME;
window[Plugin.id] = window[Plugin.id] || {
    running: false,
    stopped: false,
    logs: [],
    results: [],
    progress: {current: 0, total: 0},
};

const state = window[Plugin.id]

const onRename = async () => {

    let file = await Plugins.picker.single(
        "请选择要重命名的检测配置文件",
        jsonFiles.map((v) => ({
            label: v.name,
            value: v,
        })),
        [],
    );
    const text = await Plugins.ReadFile(`${BASE_DIR}/${file.name}`);

    const configsMap = JSON.parse(text);
    await beautifyNodeName(new Map(Object.entries(configsMap)))
    Plugins.message.success(`美化成功`);
}

const onSubscribe = async (/** @type {any} */ proxies) => {
    try {
        let file = await Plugins.picker.single(
            "请选择要重命名的检测配置文件",
            jsonFiles.map((v) => ({
                label: v.name,
                value: v,
            })),
            [],
        );
        const text = await Plugins.ReadFile(`${BASE_DIR}/${file.name}`);
        const configsMap = JSON.parse(text);

        // 核心：确保 await 后的结果被正确接收
        const result = await beautifyNodeName(new Map(Object.entries(configsMap)), proxies);

        // 关键点：某些插件钩子不仅要求你修改 store，还需要返回处理后的 proxies
        return result || proxies;

    } catch (err) {
        console.error("onSubscribe 执行出错:", err);
        // 如果出错，必须返回原始 proxies，否则会导致订阅失效
        return proxies;
    }
    Plugins.message.success(`美化成功`);

}

async function beautifyNodeName(configsMap, oldProxies) {
    const currentSub = configsMap.get(`currentSubscribe`);
    if (!currentSub) throw new Error("缺少 currentSubscribe 配置");

    const proxies = currentSub['proxies'];
    const id = currentSub['id'];
    const result = configsMap.get(`result`) || [];

    // 存入 Map
    result.forEach(item => {
        const nodeName = Object.keys(item)[0];
        configsMap.set(nodeName, item[nodeName]);
    });
    // 改用 map，明确返回转换后的对象
    const addon = (oldProxies ?? proxies).map(proxie => {
        const tag = proxie['tag'];
        const newVar = configsMap.get(tag);

        if (!newVar) return proxie; // 没找到数据，原样返回

        const score = parseFloat((newVar.purity || '').replace('%', ''));
        let purityLabel = !isNaN(score)
            ? (score >= 80 ? '✅' : score >= 50 ? '⚠️' : '❌') + newVar.purity
            : '❓N/A';

        const typeMap = {residential: '🏠住宅', datacenter: '🗄️机房'};
        const typeLabel = typeMap[newVar.ipType] || ('⚪' + newVar.ipType);
        const nativeLabel = newVar.native ? '🟢原生' : '🔵广播';

        // 关键：返回新的对象或修改后的原对象
        proxie['tag'] = `${tag} [` + typeLabel + '|' + nativeLabel + '|' + purityLabel + ']';
        return proxie;
    });
    // console.log(`addon：`, addon);
    // console.log(`oldProxies：`, oldProxies);

    Plugins.useSubscribesStore().getSubscribeById(id).proxies = addon;
    return addon;
}

function buildTag(originalTag, result) {
    const typeMap = {residential: '🏠住宅', datacenter: '🗄️机房'}
    const typeLabel = typeMap[result.ipType] || ('⚪' + result.ipType)
    const nativeLabel = result.native ? '🟢原生' : '🔵广播'
    const score = parseFloat((result.purity || '').replace('%', ''))
    let purityLabel
    if (!isNaN(score)) {
        if (score >= 80) purityLabel = '✅' + result.purity
        else if (score >= 50) purityLabel = '⚠️' + result.purity
        else purityLabel = '❌' + result.purity
    } else {
        purityLabel = '❓N/A'
    }
    return originalTag + ' [' + typeLabel + '|' + nativeLabel + '|' + purityLabel + ']'
}

async function getSelectorMembers(base, bearer, sel) {
    const res = await Plugins.HttpGet(
        base + '/proxies/' + encodeURIComponent(sel),
        {'Authorization': 'Bearer ' + bearer}
    )
    // console.log(base + '/proxies/' +sel)
    // console.log(res)
    if (res.status !== 200) throw new Error('HTTP ' + res.status)
    const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
    return data.all || []
}

async function getAllProxies(base, bearer) {
    const res = await Plugins.HttpGet(
        base + '/proxies',
        {'Authorization': 'Bearer ' + bearer}
    )
    // console.log(`${base}/proxies?AuthorizationBearer ${bearer}`);
    if (res.status !== 200) throw new Error('HTTP ' + res.status)
    return typeof res.body === 'string' ? JSON.parse(res.body) : res.body
}

async function switchSelector(base, bearer, sel, nodeTag) {
    try {
        const res = await Plugins.HttpPut(
            base + '/proxies/' + encodeURIComponent(sel),
            {'Authorization': 'Bearer ' + bearer, 'Content-Type': 'application/json'},
            {name: nodeTag}  // ← 对象，不是字符串
        )
        return res.status === 200 || res.status === 204
    } catch (e) {
        return false
    }
}

async function detectIp() {
    for (let i = 1; i <= 3; i++) {
        try {
            const res = await Plugins.HttpGet(
                'https://my.ippure.com/v1/info',
                {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                },
                {Timeout: 10000}
            )
            if (res.status !== 200) {
                await Plugins.sleep(2000);
                continue
            }
            const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body
            if (!data.ip) {
                await Plugins.sleep(2000);
                continue
            }
            const purityScore = data.fraudScore != null ? 100 - data.fraudScore : null
            return {
                ip: data.ip,
                purity: purityScore != null ? purityScore + '%' : '❓',
                ipType: data.isResidential ? 'residential' : 'datacenter',
                native: !data.isBroadcast,
                countryCode: data.countryCode || 'unknown',
                country: data.country || 'unknown',
                region: data.region || 'unknown',
                regionCode: data.regionCode || 'unknown',
                city: data.city || 'unknown',
            }
        } catch (e) {
            if (i < 3) await Plugins.sleep(2000)
        }
    }
    return null
}

/* 触发器 手动触发 */
const onRun = async () => {
    const modal = createUI()
    modal.open()
}

const createUI = () => {
    const component = {
        template: `
          <div>
            <Card title="📂 配置文件">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:120px;flex-shrink:0">config.json 路径</span>
                <Input v-model="configPath" placeholder="例: /data/sing-box/config.json" style="flex:1"/>
                <Button :loading="loadingConfig" @click="loadConfig">读取</Button>
              </div>
              <div v-if="configLoadMsg"
                   :style="{marginTop:'6px',fontSize:'12px',color: configLoadOk ? '#4ade80' : '#f87171'}">
                {{ configLoadMsg }}
              </div>
            </Card>

            <Card title="⚙️ 检测配置" style="margin-top:8px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <span style="width:120px;flex-shrink:0">Clash API 地址</span>
                <Input v-model="apiBase" style="flex:1"/>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <span style="width:120px;flex-shrink:0">API Secret</span>
                <Input v-model="apiBearer" style="flex:1"/>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <span style="width:120px;flex-shrink:0">Selector 名称</span>
                <Input v-model="selectorTag" style="flex:1"/>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:120px;flex-shrink:0">检测间隔 (ms)</span>
                <Input v-model="delay" style="width:100px"/>
              </div>
            </Card>

            <Card style="margin-top:8px">
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <Button type="primary" icon="play" :disabled="running" @click="startCheck">
                  {{ running ? ('检测中 ' + progress.current + '/' + progress.total) : '开始检测' }}
                </Button>
                <Button icon="stop" :disabled="!running" @click="stopCheck">停止</Button>
                <Button @click="testApi">🔧 测试API</Button>
                <Button @click="clearAll">清空</Button>
              </div>
            </Card>
            <Card title="✋ 保存设置">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:120px;flex-shrink:0">自定义文件名</span>
                <Input v-model="saveJsonName" placeholder="默认：plugin-ip-checker.json" style="flex:1"/>
                <Button @click="saveDetectionJsonFile">⚡ 保存检测文件</Button>
              </div>
              <div v-if="configLoadMsg"
                   :style="{marginTop:'6px',fontSize:'12px',color: configLoadOk ? '#4ade80' : '#f87171'}">
                {{ configLoadMsg }}
              </div>
            </Card>
            <Card v-if="results.length > 0" title="📊 检测结果" style="margin-top:8px">
              <Table :data-source="results" :columns="resultColumns"/>
            </Card>

            <Card title="📋 日志" style="margin-top:8px">
              <div
                  style="background:#111827;border-radius:6px;padding:10px;height:220px;overflow-y:auto;font-family:monospace;font-size:12px;line-height:1.7;user-select:text;cursor:text">
                <div v-for="(log, i) in logs" :key="i" :style="{color: logColor(log.type), userSelect: 'text'}">
                  {{ log.time }} {{ log.msg }}
                </div>
                <div v-if="!logs.length" style="color:#4b5563">暂无日志...</div>
              </div>
            </Card>

          </div>
        `,
        setup() {
            const {ref} = Vue

            const configPath = ref('/data/sing-box/config.json')
            const saveJsonName = ref('plugin-ip-checker.json')
            const loadingConfig = ref(false)
            const configLoadMsg = ref('')
            const configLoadOk = ref(false)

            let defaultBase = 'http://127.0.0.1:9090'
            let defaultBearer = ''
            try {
                const profile = Plugins.useProfilesStore().currentProfile
                if (profile?.experimental?.clash_api) {
                    const ctrl = profile.experimental.clash_api.external_controller || '127.0.0.1:9090'
                    defaultBase = 'http://127.0.0.1:' + (ctrl.split(':')[1] || '9090')
                    defaultBearer = profile.experimental.clash_api.secret || ''
                }
            } catch (e) {
            }

            const apiBase = ref(defaultBase)
            const apiBearer = ref(defaultBearer)
            const selectorTag = ref('🚀 节点选择')
            const delay = ref('2500')
            const running = ref(state.running)
            const progress = ref(state.progress)
            const results = ref(state.results)
            const logs = ref(state.logs)

            const resultColumns = [
                {key: 'index', title: '#'},
                {key: 'origTag', title: '原始名称'},
                {key: 'ip', title: 'IP'},
                {key: 'country', title: '地区'},
                {key: 'ipType', title: '类型'},
                {key: 'native', title: '原生'},
                {key: 'purity', title: '纯净度'},
                {key: 'newTag', title: '新标签'},
            ]

            const configsMap = ref(new Map());

// 获取当前使用的配置（为了获取当前使用的订阅ID）
            const currentProfile = Plugins.useProfilesStore().currentProfile;


            const targetObj = currentProfile.outbounds.filter(outbound => {
                if ('🚀 节点选择' === outbound?.tag) {
                    return outbound;
                }
            })[0].outbounds.filter(outbound => {
                if ('Subscription' === outbound?.type) {
                    return outbound;
                }
            })[0]
            const currentSubscribe = Plugins.useSubscribesStore().getSubscribeById(targetObj.id);
            configsMap.value.set('currentProfile', targetObj);
            configsMap.value.set('currentSubscribe', currentSubscribe);

            function addLog(type, msg) {
                const d = new Date()
                const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
                    .map(n => String(n).padStart(2, '0')).join(':')
                state.logs = [...state.logs, {type, time, msg}]
                logs.value = state.logs
            }

            function logColor(type) {
                return {info: '#9ca3af', success: '#4ade80', warn: '#facc15', error: '#f87171'}[type] || '#9ca3af'
            }

            function clearAll() {
                state.logs = [];
                state.results = [];
                state.progress = {current: 0, total: 0}
                logs.value = state.logs;
                results.value = state.results;
                progress.value = state.progress
            }

            function stopCheck() {
                state.stopped = true
                addLog('warn', '⏹ 用户手动停止')
            }

            async function testApi() {
                addLog('info', '🔧 测试 API: ' + apiBase.value)
                try {
                    const data = await getAllProxies(apiBase.value, apiBearer.value)
                    const proxies = data.proxies || {}
                    const keys = Object.keys(proxies)
                    addLog('success', 'API 连通，共 ' + keys.length + ' 个 proxy')
                    keys.forEach(k => {
                        const p = proxies[k]
                        if (p.type === 'Selector' || p.type === 'URLTest') {
                            addLog('success', '  [' + p.type + '] ' + k)
                        }
                    })
                } catch (e) {
                    addLog('error', '❌ ' + e.message)
                }
            }

            async function saveDetectionJsonFile() {
                const fileName = saveJsonName.value;

                if (!fileName) {
                    Plugins.message.error(`待保存的文件名为空`)
                    return;
                }
                // 使用 Object.fromEntries 将 Map 转为普通对象
                const obj = Object.fromEntries(configsMap.value);
                const jsonString = JSON.stringify(obj, null, 2); // 格式化
                // console.log(`jsonString:`, jsonString);
                // console.log(`configsMap:`, configsMap);
                try {
                    await Plugins.WriteFile(`${BASE_DIR}/${fileName}`, jsonString);
                    console.log(`写入【${BASE_DIR}/${fileName}】文件成功！`);
                    Plugins.message.success(`写入【${fileName}】文件成功！`);
                } catch (error) {
                    if (error === '写入失败') {
                        failed = true
                    }
                    console.log(`${BASE_DIR}/${fileName}` + ' ： ' + error)
                    Plugins.message.error(`写入失败：` + error)
                } finally {
                    await Plugins.sleep(100)
                }
            }


            async function loadConfig() {
                if (!configPath.value.trim()) {
                    configLoadMsg.value = '请先输入路径'
                    configLoadOk.value = false
                    return
                }
                loadingConfig.value = true
                // console.log(`async function loadConfig() loadingConfig.value `, loadingConfig.value);
                configLoadMsg.value = ''
                try {
                    const exists = await Plugins.FileExists(configPath.value.trim())
                    if (!exists) {
                        configLoadMsg.value = '❌ 文件不存在: ' + configPath.value
                        configLoadOk.value = false
                        return
                    }
                    const text = await Plugins.ReadFile(configPath.value.trim(), {Mode: 'Text'})
                    const json = JSON.parse(text)
                    const clashApi = json?.experimental?.clash_api
                    if (clashApi) {
                        const ctrl = clashApi.external_controller || '127.0.0.1:9090'
                        apiBase.value = 'http://127.0.0.1:' + (ctrl.split(':')[1] || '9090')
                        apiBearer.value = clashApi.secret || ''
                    }
                    const outbounds = json?.outbounds || []
                    const nodeCount = outbounds.filter(o =>
                        !['selector', 'urltest', 'direct', 'block', 'dns'].includes(o.type)
                    ).length
                    configLoadMsg.value = '✅ 读取成功！解析到 ' + nodeCount + ' 个节点，API 配置已自动填充'
                    configLoadOk.value = true
                } catch (e) {
                    configLoadMsg.value = '❌ 解析失败: ' + e.message
                    configLoadOk.value = false
                } finally {
                    // loadingConfig.value = false
                }
            }

            /**
             * 开始检测
             * @returns {Promise<void>}
             */
            async function startCheck() {
                // console.log(`startCheck: loadingConfig.value`, loadingConfig.value);

                if (loadingConfig.value === false) {
                    // console.log(`请先输入路径`);
                    Plugins.message.error(`请先输入路径`);
                    configLoadOk.value = false;
                    return
                }

                state.running = true;
                state.stopped = false
                state.logs = [];
                state.results = [];
                state.progress = {current: 0, total: 0}
                running.value = true;
                logs.value = state.logs
                results.value = state.results;
                progress.value = state.progress

                try {
                    // 获取完整 proxies 数据用于过滤组类型
                    const allProxiesData = await getAllProxies(apiBase.value, apiBearer.value)
                    const proxiesMap = allProxiesData.proxies || {}

                    addLog('info', '🔍 获取成员: ' + selectorTag.value)
                    const allMembers = await getSelectorMembers(apiBase.value, apiBearer.value, selectorTag.value)
                    addLog('info', '📡 成员数: ' + allMembers.length)

                    if (!allMembers.length) {
                        addLog('error', '❌ 未获取到成员，请先点「🔧 测试API」确认 selector 名称')
                        return
                    }

                    // 过滤内置节点 + Selector/URLTest 组
                    const skip = new Set(['DIRECT', 'REJECT', 'BLOCK', 'dns-out'])
                    const realMembers = allMembers.filter(n => {
                        if (skip.has(n)) return false
                        const p = proxiesMap[n]
                        if (p && (p.type === 'Selector' || p.type === 'URLTest')) return false
                        return true
                    })

                    configsMap.value.set('realProiex', realMembers);

                    addLog('info', '✅ 真实节点: ' + realMembers.length + ' 个')

                    state.progress = {current: 0, total: realMembers.length}
                    progress.value = state.progress
                    let resultList = []
                    let lastIp = null
                    for (let i = 0; i < realMembers.length; i++) {
                        if (state.stopped) break
                        const apiTag = realMembers[i]
                        state.progress = {current: i + 1, total: realMembers.length}
                        progress.value = state.progress
                        addLog('info', '[' + (i + 1) + '/' + realMembers.length + '] 🔄 ' + apiTag)

                        const switched = await switchSelector(apiBase.value, apiBearer.value, selectorTag.value, apiTag)
                        if (!switched) {
                            addLog('error', '  ❌ 切换失败');
                            continue
                        }

                        await Plugins.sleep(2000)

                        const result = await detectIp()
                        if (!result) {
                            addLog('error', '  ❌ 检测失败');
                            continue
                        }
                        resultList.push({[apiTag]: result})
                        if (lastIp && result.ip === lastIp) addLog('warn', '  ⚠️ IP 重复: ' + result.ip)
                        lastIp = result.ip

                        const newTag = buildTag(apiTag, result)
                        state.results = [...state.results, {
                            index: i + 1, origTag: apiTag, ip: result.ip, country: result.country,
                            ipType: result.ipType === 'residential' ? '🏠住宅' : '🗄️机房',
                            native: result.native ? '🟢原生' : '🔵广播',
                            purity: result.purity, newTag,
                        }]
                        results.value = state.results
                        addLog('success', '  ✅ → ' + newTag)

                        if (i < realMembers.length - 1 && !state.stopped) {
                            await Plugins.sleep(parseInt(delay.value) || 2500)
                        }
                    }
                    configsMap.value.set('result', resultList);
                    // console.log(`configsMap.value.set('result', resultList);=>`, configsMap)
                    addLog('info', '🎉 完成，共 ' + state.results.length + ' 个节点')
                    Plugins.message.success('检测完成！共 ' + state.results.length + ' 个节点')
                } catch (e) {
                    addLog('error', '❌ ' + e.message)
                    Plugins.message.error(e.message)
                } finally {
                    state.running = false;
                    running.value = false
                }
            }

            return {
                configPath, saveJsonName, loadingConfig, configLoadMsg, configLoadOk, loadConfig,
                apiBase, apiBearer, selectorTag, delay,
                running, progress, results, logs, resultColumns,
                logColor, clearAll, stopCheck, testApi, saveDetectionJsonFile, startCheck,
            }
        }

        ,
    }

    const modal = Plugins.modal(
        {
            title: Plugin.name,
            maskClosable: true,
            submit: false,
            width: "90",
            height: "90",
            cancelText: "common.close",
            afterClose() {
                modal.destroy()
            },
        },
        {
            default: () => Vue.h(component),
        },
    )

    return modal
}
