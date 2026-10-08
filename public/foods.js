/* ============================================================
 * PULSE DIET · 食物营养库
 * ------------------------------------------------------------
 * n  = 每 100g 的营养（处于 base 状态）
 *      p 蛋白 g / f 脂肪 g / c 总碳水 g / fiber 膳食纤维 g / kcal 千卡
 * base  = 'raw' 生重基准 或 'cooked' 熟重基准
 * yield = 熟重 / 生重。1 表示生熟无差异。
 *    · 肉类 ~0.75（失水）、鱼 ~0.78
 *    · 燕麦干→粥 = 3.0、白米生→饭 = 2.6（吸水增重）
 *    · 蒸薯类 ~0.95（去皮与少量失水）
 * 由 base + yield 自动推导另一状态的每 100g 值：
 *    base=raw    → cooked 每100g = n / yield
 *    base=cooked → raw    每100g = n * yield
 *
 * units[].state 可覆盖状态（例：燕麦「碗(粥)」自动切到 cooked）
 * tags: fastcarb 快碳 / omega3 / visibleFat 可见脂肪 / supp 补剂 / legume 豆类
 * ============================================================ */

window.CATEGORIES = [
  { key: 'protein', name: '蛋白质', icon: 'fa-drumstick-bite',  color: '#10B981' },
  { key: 'fat',     name: '脂肪',   icon: 'fa-cheese',          color: '#F59E0B' },
  { key: 'carb',    name: '碳水',   icon: 'fa-bread-slice',     color: '#38BDF8' },
  { key: 'vege',    name: '蔬菜',   icon: 'fa-leaf',            color: '#22C55E' },
  { key: 'fruit',   name: '水果',   icon: 'fa-apple-whole',     color: '#FB7185' },
  { key: 'nut',     name: '坚果',   icon: 'fa-seedling',        color: '#A78BFA' }
];

window.FOOD_DB = [
  /* ---------------- 蛋白质 ---------------- */
  { id:'salmon', name:'三文鱼', cat:'protein', base:'raw', yield:0.78,
    n:{ p:20.4, f:13.4, c:0, fiber:0, kcal:208 },
    units:[{k:'g',label:'克',g:1},{k:'block',label:'块',g:120}],
    tags:['omega3'], note:'富含 Omega-3，休息日抗炎组合首选' },

  { id:'tuna_can', name:'金枪鱼罐头', cat:'protein', base:'cooked', yield:1,
    n:{ p:25.5, f:1.0, c:0, fiber:0, kcal:116 },
    units:[{k:'g',label:'克',g:1},{k:'can',label:'罐(沥干)',g:120}],
    tags:[], note:'按水浸沥干计；油浸罐头脂肪约为此值 8 倍' },

  { id:'beef', name:'牛肉(瘦)', cat:'protein', base:'raw', yield:0.75,
    n:{ p:20.2, f:4.2, c:0, fiber:0, kcal:125 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}],
    tags:[], note:'' },

  { id:'chicken', name:'去皮鸡胸肉', cat:'protein', base:'raw', yield:0.75,
    n:{ p:22.5, f:1.9, c:0, fiber:0, kcal:110 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}],
    tags:[], note:'脂肪最低的完整蛋白' },

  { id:'pork', name:'猪肉(瘦)', cat:'protein', base:'raw', yield:0.75,
    n:{ p:20.3, f:6.2, c:0, fiber:0, kcal:143 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}],
    tags:[], note:'' },

  { id:'egg', name:'水煮鸡蛋', cat:'protein', base:'cooked', yield:1,
    // 校准：碳水 2.8 → 1.1（禽蛋几乎不含糖，2.8 多见于旧版成分表或含添加物的蛋制品）
    // 热量 143 采用蛋类专属 Atwater 系数（蛋白 4.36 / 脂肪 9.02 / 碳水 3.68）折算，
    // 因此与通用 4/9/4 算出的 136.8 有约 6 kcal 差异——这是蛋类的标准处理方式。
    n:{ p:13.3, f:8.8, c:1.1, fiber:0, kcal:143 },
    units:[{k:'pcs',label:'个',g:50},{k:'g',label:'克',g:1}],
    tags:[], note:'1 个≈50g；2 个煮鸡蛋≈100g' },

  { id:'fish_fw', name:'淡水鱼肉', cat:'protein', base:'raw', yield:0.78,
    n:{ p:17.5, f:3.5, c:0, fiber:0, kcal:105 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}],
    tags:[], note:'草鱼/鲫鱼/鲈鱼等均值' },

  { id:'milk', name:'牛奶(全脂)', cat:'protein', base:'cooked', yield:1,
    // 校准：优质鲜乳蛋白 3.0 → 3.3，脂肪 3.2 → 3.6（现代高品质鲜乳实测）
    n:{ p:3.3, f:3.6, c:4.8, fiber:0, kcal:65 },
    units:[{k:'g',label:'克/毫升',g:1},{k:'cup',label:'杯',g:200},{k:'box',label:'盒',g:250}],
    tags:[], note:'200 克牛奶为常见一份；休息日可砍（液体热量+乳糖）' },

  { id:'yogurt', name:'酸奶(无糖全脂)', cat:'protein', base:'cooked', yield:1,
    // 校准：碳水 9.0 → 5.0。9.0 通常是「风味/添加糖」酸奶；纯天然发酵无糖酸奶的
    // 碳水几乎全部来自乳糖，应在 4.5-5.5 之间。严格控糖请务必按无糖口径记录。
    n:{ p:3.5, f:3.2, c:5.0, fiber:0, kcal:63 },
    units:[{k:'bowl',label:'碗(三大勺)',g:250},{k:'cup',label:'杯',g:150},{k:'g',label:'克',g:1}],
    tags:[], note:'一碗（三大勺）≈250 克' },

  { id:'protein_powder', name:'蛋白粉(80%)', cat:'protein', base:'cooked', yield:1,
    n:{ p:80, f:6, c:8, fiber:0, kcal:400 },
    units:[{k:'scoop',label:'勺',g:30},{k:'g',label:'克',g:1}],
    tags:['supp'], note:'围训练期使用；休息日不用' },

  { id:'smoked_chicken', name:'烟熏鸡胸', cat:'protein', base:'cooked', yield:1,
    n:{ p:20, f:3, c:2, fiber:0, kcal:120 },
    units:[{k:'g',label:'克',g:1},{k:'slice',label:'片',g:20}],
    tags:[], note:'钠含量偏高，注意全天血压' },

  { id:'beans', name:'杂豆(熟)', cat:'protein', base:'cooked', yield:1,
    n:{ p:8.9, f:0.5, c:20.0, fiber:6.4, kcal:128 },
    units:[{k:'scoop',label:'勺',g:32.5},{k:'bowl',label:'碗',g:200},{k:'g',label:'克',g:1}],
    tags:['legume'], note:'4 勺豆子 = 130 克；浸泡弃水可去 33-59% 胀气糖' },

  { id:'tofu_firm', name:'北豆腐(老豆腐)', cat:'protein', base:'cooked', yield:1,
    n:{ p:12.2, f:4.8, c:1.5, fiber:0.4, kcal:98 },
    units:[{k:'g',label:'克',g:1},{k:'block',label:'块(小)',g:100}],
    tags:[], note:'植物蛋白及钙质来源；钙含量约 350mg/100g（卤水/石膏点制）' },

  { id:'natto', name:'纳豆', cat:'protein', base:'cooked', yield:1,
    // 校准：对齐 USDA 纳豆口径（P 19.4 / F 11.0 / C 12.7 / 纤维 5.4 / 211 kcal），
    // 蛋白质取 18.0 保守值。旧值 16.5/10.0/14.4/200 为日本标准成分表口径，两者均可查，
    // 此处统一到蛋白更高、碳水更低的一侧。
    n:{ p:18.0, f:11.0, c:13.0, fiber:5.4, kcal:211 },
    units:[{k:'box',label:'盒',g:50},{k:'g',label:'克',g:1}],
    tags:['legume','omega3'], note:'纳豆激酶 + Omega-3 抗炎组合' },

  /* ---------------- 脂肪 ---------------- */
  { id:'cheese', name:'芝士', cat:'fat', base:'cooked', yield:1,
    n:{ p:25.7, f:23.5, c:1.5, fiber:0, kcal:328 },
    units:[{k:'g',label:'克',g:1},{k:'slice',label:'片',g:20}],
    tags:['visibleFat'], note:'同时含 25.7g 蛋白，别只当脂肪算' },

  { id:'avocado', name:'牛油果', cat:'fat', base:'cooked', yield:1,
    n:{ p:2.0, f:15.3, c:8.5, fiber:6.7, kcal:171 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个(可食)',g:140}],
    tags:['visibleFat'], note:'净碳水仅 1.8g；训练日练后禁区' },

  { id:'oil', name:'食用油', cat:'fat', base:'cooked', yield:1,
    n:{ p:0, f:100, c:0, fiber:0, kcal:900 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'勺',g:5},{k:'tsp',label:'茶匙',g:5}],
    tags:['visibleFat'], note:'1 勺≈5g≈45kcal，最易被漏记的隐形脂肪' },

  { id:'olive_oil', name:'特级初榨橄榄油', cat:'fat', base:'cooked', yield:1,
    n:{ p:0, f:100.0, c:0, fiber:0, kcal:900 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'勺',g:10}],
    tags:['visibleFat','omega3'], note:'橄榄油以油酸(MUFA)为主，Omega-3 极少；此标签仅用于「优质脂肪」筛选' },

  /* ---------------- 碳水 ---------------- */
  { id:'bread', name:'粗粮面包', cat:'carb', base:'cooked', yield:1,
    n:{ p:10.0, f:3.5, c:45.0, fiber:6.0, kcal:250 },
    units:[{k:'g',label:'克',g:1},{k:'slice',label:'片',g:35}],
    tags:['fastcarb'], note:'' },

  { id:'oats', name:'燕麦', cat:'carb', base:'raw', yield:3.0,
    n:{ p:13.2, f:6.5, c:67.7, fiber:10.1, kcal:377 },
    units:[{k:'g',label:'克(干)',g:1},{k:'scoop',label:'勺(干)',g:10},
           {k:'bowl',label:'碗(粥)',g:200, state:'cooked'}],
    tags:[], note:'一碗燕麦粥 200 克（熟）≈干燕麦 67 克' },

  { id:'corn', name:'玉米', cat:'carb', base:'cooked', yield:1,
    n:{ p:4.0, f:1.5, c:22.8, fiber:2.9, kcal:112 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个(小·可食)',g:70}],
    tags:[], note:'一个小玉米棒 = 70 克' },

  { id:'sweet_potato', name:'红薯', cat:'carb', base:'cooked', yield:0.95,
    n:{ p:1.6, f:0.2, c:25.0, fiber:3.0, kcal:110 },
    units:[{k:'g',label:'克',g:1},{k:'sm',label:'个(小)',g:40},{k:'md',label:'个(中)',g:60}],
    tags:[], note:'小 40 克 / 中 60 克' },

  { id:'purple_potato', name:'紫薯', cat:'carb', base:'cooked', yield:0.95,
    n:{ p:1.7, f:0.3, c:26.0, fiber:3.5, kcal:115 },
    units:[{k:'g',label:'克',g:1},{k:'sm',label:'个(小)',g:40},{k:'md',label:'个(中)',g:60}],
    tags:[], note:'花青素高于普通红薯' },

  { id:'pumpkin', name:'蒸南瓜', cat:'carb', base:'cooked', yield:1,
    n:{ p:0.8, f:0.1, c:7.0, fiber:1.0, kcal:32 },
    units:[{k:'g',label:'克',g:1},{k:'block',label:'块',g:100}],
    tags:[], note:'热量密度极低，适合填满胃部' },

  { id:'potato', name:'蒸土豆', cat:'carb', base:'cooked', yield:0.95,
    n:{ p:2.0, f:0.1, c:17.2, fiber:2.2, kcal:77 },
    units:[{k:'g',label:'克',g:1},{k:'sm',label:'个(小)',g:40}],
    tags:[], note:'一个小土豆 = 40 克' },

  { id:'rice', name:'白米饭(熟)', cat:'carb', base:'cooked', yield:2.6,
    n:{ p:2.6, f:0.3, c:25.9, fiber:0.3, kcal:116 },
    units:[{k:'g',label:'克',g:1},{k:'bowl',label:'碗',g:150}],
    tags:['fastcarb'], note:'练后正餐主力；休息日禁区' },

  { id:'chickpeas', name:'鹰嘴豆(熟)', cat:'carb', base:'cooked', yield:1,
    n:{ p:8.9, f:2.6, c:27.4, fiber:7.6, kcal:164 },
    units:[{k:'g',label:'克',g:1},{k:'bowl',label:'碗',g:200}],
    tags:['legume'], note:'优秀的慢碳和植物蛋白双重来源' },

  { id:'red_beans', name:'红豆(熟)', cat:'carb', base:'cooked', yield:1,
    n:{ p:7.5, f:0.1, c:24.8, fiber:7.3, kcal:128 },
    units:[{k:'g',label:'克',g:1},{k:'bowl',label:'碗',g:200}],
    tags:['legume'], note:'高钾高纤维，训练日优质抗炎碳水选择' },

  /* ---------------- 蔬菜 ---------------- */
  { id:'dark_vege', name:'深色蔬菜', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.4, f:0.4, c:5.5, fiber:2.8, kcal:35 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:250}],
    tags:[], note:'全天目标 500 克（两日皆然）' },

  /* ---------------- 水果 ---------------- */
  { id:'apple', name:'苹果', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.2, f:0.2, c:13.5, fiber:1.2, kcal:53 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个(中偏小)',g:160}],
    tags:[], note:'一个中等偏小苹果 = 160 克' },

  { id:'orange', name:'橘子', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.8, f:0.2, c:11.1, fiber:1.4, kcal:48 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个',g:150}],
    tags:[], note:'训练日练后的可选快碳来源' },

  { id:'banana', name:'香蕉', cat:'fruit', base:'cooked', yield:1,
    n:{ p:1.1, f:0.3, c:23.0, fiber:1.2, kcal:93 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个(可食)',g:100},{k:'half',label:'半根',g:50}],
    tags:['fastcarb'], note:'练前/练后各半根；休息日禁区' },

  { id:'blueberry', name:'蓝莓', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.7, f:0.3, c:14.5, fiber:2.4, kcal:57 },
    units:[{k:'g',label:'克',g:1},{k:'box',label:'盒',g:125}],
    tags:[], note:'低升糖，休息日首选水果' },

  /* ---------------- 坚果 ---------------- */
  { id:'pumpkin_seed', name:'南瓜子仁', cat:'nut', base:'cooked', yield:1,
    n:{ p:30.2, f:49.1, c:10.7, fiber:6.1, kcal:576 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'勺',g:10}],
    tags:[], note:'一勺南瓜子仁 = 10 克' },

  { id:'cashew', name:'腰果', cat:'nut', base:'cooked', yield:1,
    n:{ p:17.3, f:36.7, c:41.6, fiber:3.6, kcal:559 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'勺',g:10}],
    tags:[], note:'碳水是坚果里最高的' },

  { id:'almond', name:'巴旦木', cat:'nut', base:'cooked', yield:1,
    n:{ p:21.2, f:49.9, c:21.6, fiber:12.5, kcal:579 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'勺(约10粒)',g:10},{k:'pcs',label:'粒',g:1}],
    tags:[], note:'一勺 10 粒 = 10 克；纤维最高' },

  { id:'macadamia', name:'夏威夷果', cat:'nut', base:'cooked', yield:1,
    n:{ p:7.9, f:75.8, c:13.8, fiber:8.6, kcal:718 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'粒',g:3}],
    tags:[], note:'脂肪比例最高，1 粒≈3 克' },

  { id:'walnut', name:'大核桃', cat:'nut', base:'cooked', yield:1,
    n:{ p:15.2, f:65.2, c:13.7, fiber:6.7, kcal:654 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'粒(半仁)',g:5}],
    tags:['omega3'], note:'植物性 Omega-3 来源' },

  { id:'pecan', name:'碧根果', cat:'nut', base:'cooked', yield:1,
    n:{ p:9.2, f:72.0, c:13.9, fiber:9.6, kcal:691 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'颗(半仁)',g:1.5}],
    tags:[], note:'极高脂肪比例，休息日抗炎与优质脂肪核心来源' },
  /* ================= 2026-10-08 扩充：常见食物 =================
   * 需求：用户要能直接看到更多常见食物并直接选，不必再去「食物库」里翻。
   * 数据口径：中国食物成分表常见值，优先取「可食部 · 常见做法」。
   * ============================================================ */

  /* ---------------- 常见蔬菜（原只有「深色蔬菜」1 条，补到 13 条） ---------------- */
  { id:'broccoli', name:'西兰花', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.8, f:0.4, c:7.0, fiber:2.6, kcal:34 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:150}], tags:[], note:'深色蔬菜，维C与萝卜硫素' },
  { id:'spinach', name:'菠菜', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.9, f:0.4, c:3.6, fiber:2.2, kcal:23 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:150}], tags:[], note:'建议焯水去草酸后再称重' },
  { id:'lettuce', name:'生菜', cat:'vege', base:'cooked', yield:1,
    n:{ p:1.4, f:0.2, c:2.9, fiber:1.3, kcal:15 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:120}], tags:[], note:'' },
  { id:'tomato', name:'番茄', cat:'vege', base:'cooked', yield:1,
    n:{ p:0.9, f:0.2, c:3.9, fiber:1.2, kcal:18 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个',g:150}], tags:[], note:'' },
  { id:'cucumber', name:'黄瓜', cat:'vege', base:'cooked', yield:1,
    n:{ p:0.7, f:0.1, c:3.6, fiber:0.5, kcal:15 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'根',g:200}], tags:[], note:'' },
  { id:'carrot', name:'胡萝卜', cat:'vege', base:'cooked', yield:1,
    n:{ p:0.9, f:0.2, c:10.0, fiber:2.8, kcal:41 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'根',g:120}], tags:[], note:'' },
  { id:'asparagus', name:'芦笋', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.2, f:0.1, c:3.9, fiber:2.1, kcal:20 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}], tags:[], note:'' },
  { id:'mushroom', name:'香菇(鲜)', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.2, f:0.3, c:5.2, fiber:2.3, kcal:34 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}], tags:[], note:'' },
  { id:'bell_pepper', name:'彩椒', cat:'vege', base:'cooked', yield:1,
    n:{ p:1.0, f:0.3, c:6.0, fiber:2.1, kcal:31 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个',g:120}], tags:[], note:'' },
  { id:'cabbage', name:'大白菜', cat:'vege', base:'cooked', yield:1,
    n:{ p:1.5, f:0.1, c:3.2, fiber:1.0, kcal:20 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:200}], tags:[], note:'' },
  { id:'okra', name:'秋葵', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.0, f:0.1, c:7.0, fiber:3.2, kcal:33 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}], tags:[], note:'' },
  { id:'eggplant', name:'茄子', cat:'vege', base:'cooked', yield:1,
    n:{ p:1.0, f:0.2, c:5.7, fiber:3.0, kcal:25 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'个',g:200}], tags:[], note:'吸油强，记得另记实际用油' },

  /* ---------------- 常见水果 ---------------- */
  { id:'kiwi', name:'猕猴桃', cat:'fruit', base:'cooked', yield:1,
    n:{ p:1.1, f:0.5, c:15.0, fiber:3.0, kcal:61 },
    units:[{k:'pcs',label:'个',g:90},{k:'g',label:'克',g:1}], tags:[], note:'维C密度极高' },
  { id:'grape', name:'葡萄', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.7, f:0.2, c:18.0, fiber:0.9, kcal:69 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'串',g:150}], tags:[], note:'' },
  { id:'pear', name:'梨', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.4, f:0.1, c:13.0, fiber:3.1, kcal:57 },
    units:[{k:'pcs',label:'个',g:200},{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'strawberry', name:'草莓', cat:'fruit', base:'cooked', yield:1,
    n:{ p:1.0, f:0.3, c:8.0, fiber:2.0, kcal:32 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:150}], tags:[], note:'低糖果品' },
  { id:'watermelon', name:'西瓜', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.6, f:0.2, c:8.0, fiber:0.4, kcal:30 },
    units:[{k:'g',label:'克',g:1},{k:'slice',label:'块',g:200}], tags:[], note:'' },
  { id:'pomelo', name:'柚子', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.8, f:0.2, c:10.0, fiber:1.0, kcal:42 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:150}], tags:[], note:'' },

  /* ---------------- 常见主食 ---------------- */
  { id:'mantou', name:'馒头', cat:'carb', base:'cooked', yield:1,
    n:{ p:7.0, f:1.1, c:47.0, fiber:1.3, kcal:223 },
    units:[{k:'pcs',label:'个',g:100},{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'noodle', name:'面条(煮)', cat:'carb', base:'cooked', yield:1,
    n:{ p:4.5, f:0.6, c:25.0, fiber:1.2, kcal:130 },
    units:[{k:'g',label:'克',g:1},{k:'bowl',label:'碗',g:250}], tags:[], note:'' },
  { id:'ww_bread', name:'全麦面包', cat:'carb', base:'cooked', yield:1,
    n:{ p:9.0, f:3.2, c:43.0, fiber:6.0, kcal:247 },
    units:[{k:'slice',label:'片',g:35},{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'millet_porridge', name:'小米粥', cat:'carb', base:'cooked', yield:1,
    n:{ p:1.4, f:0.4, c:8.4, fiber:0.2, kcal:46 },
    units:[{k:'bowl',label:'碗',g:300},{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'buckwheat', name:'荞麦面(煮)', cat:'carb', base:'cooked', yield:1,
    n:{ p:5.0, f:0.5, c:25.0, fiber:1.5, kcal:130 },
    units:[{k:'g',label:'克',g:1},{k:'bowl',label:'碗',g:250}], tags:[], note:'' },
  { id:'brown_rice', name:'糙米饭(熟)', cat:'carb', base:'cooked', yield:1,
    n:{ p:2.6, f:0.9, c:23.0, fiber:1.8, kcal:112 },
    units:[{k:'bowl',label:'碗',g:200},{k:'g',label:'克',g:1}], tags:[], note:'升糖低于白米饭' },
  { id:'yam', name:'山药', cat:'carb', base:'cooked', yield:1,
    n:{ p:1.9, f:0.2, c:12.0, fiber:0.8, kcal:57 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'段',g:150}], tags:[], note:'' },
  { id:'taro', name:'芋头', cat:'carb', base:'cooked', yield:1,
    n:{ p:1.5, f:0.2, c:15.0, fiber:1.0, kcal:70 },
    units:[{k:'pcs',label:'个',g:80},{k:'g',label:'克',g:1}], tags:[], note:'' },

  /* ---------------- 常见蛋白 ---------------- */
  { id:'shrimp', name:'虾仁', cat:'protein', base:'raw', yield:0.9,
    n:{ p:18.6, f:0.8, c:1.0, fiber:0, kcal:88 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}], tags:[], note:'几乎纯蛋白，脂肪极低' },
  { id:'chicken_thigh', name:'去皮鸡腿肉', cat:'protein', base:'raw', yield:0.75,
    n:{ p:19.0, f:5.0, c:0, fiber:0, kcal:130 },
    units:[{k:'g',label:'克',g:1},{k:'pcs',label:'只',g:120}], tags:[], note:'' },
  { id:'braised_beef', name:'卤牛肉', cat:'protein', base:'cooked', yield:1,
    n:{ p:31.0, f:3.5, c:2.0, fiber:0, kcal:170 },
    units:[{k:'g',label:'克',g:1},{k:'slice',label:'片',g:20}], tags:[], note:'钠偏高，注意全天血压' },
  { id:'duck_breast', name:'鸭胸肉(去皮)', cat:'protein', base:'raw', yield:0.75,
    n:{ p:19.9, f:1.9, c:0, fiber:0, kcal:100 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:120}], tags:[], note:'' },
  { id:'pork_loin', name:'猪里脊', cat:'protein', base:'raw', yield:0.75,
    n:{ p:20.2, f:2.0, c:0, fiber:0, kcal:100 },
    units:[{k:'g',label:'克',g:1},{k:'portion',label:'份',g:100}], tags:[], note:'' },
  { id:'greek_yogurt', name:'希腊酸奶(无糖)', cat:'protein', base:'cooked', yield:1,
    n:{ p:9.0, f:4.0, c:3.6, fiber:0, kcal:88 },
    units:[{k:'cup',label:'杯',g:150},{k:'g',label:'克',g:1}], tags:[], note:'蛋白密度约为普通酸奶 2.5 倍' },
  { id:'tofu_skin', name:'千张/豆腐皮', cat:'protein', base:'cooked', yield:1,
    n:{ p:24.0, f:12.0, c:5.0, fiber:0, kcal:220 },
    units:[{k:'g',label:'克',g:1},{k:'sheet',label:'张',g:40}], tags:[], note:'' },
  { id:'egg_white', name:'蛋清', cat:'protein', base:'cooked', yield:1,
    n:{ p:11.6, f:0.1, c:0.7, fiber:0, kcal:52 },
    units:[{k:'pcs',label:'个',g:33},{k:'g',label:'克',g:1}], tags:[], note:'几乎零脂零碳的纯蛋白' },

  /* ---------------- 常见脂肪 ---------------- */
  { id:'sesame_paste', name:'芝麻酱', cat:'fat', base:'cooked', yield:1,
    n:{ p:20.0, f:52.0, c:15.0, fiber:5.0, kcal:618 },
    units:[{k:'spoon',label:'勺',g:15},{k:'g',label:'克',g:1}], tags:['visibleFat'], note:'' },
  { id:'butter', name:'黄油', cat:'fat', base:'cooked', yield:1,
    n:{ p:0.9, f:81.0, c:0.1, fiber:0, kcal:717 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'小块',g:10}], tags:['visibleFat'], note:'' },

  /* ---------------- 常见坚果种子 ---------------- */
  { id:'peanut', name:'花生(炒)', cat:'nut', base:'cooked', yield:1,
    n:{ p:24.0, f:48.0, c:21.0, fiber:8.0, kcal:589 },
    units:[{k:'g',label:'克',g:1},{k:'handful',label:'把',g:25}], tags:[], note:'' },
  { id:'sunflower_seed', name:'葵花籽仁', cat:'nut', base:'cooked', yield:1,
    n:{ p:21.0, f:51.0, c:20.0, fiber:9.0, kcal:584 },
    units:[{k:'g',label:'克',g:1},{k:'spoon',label:'勺',g:12}], tags:[], note:'' },
  { id:'pistachio', name:'开心果', cat:'nut', base:'cooked', yield:1,
    n:{ p:20.0, f:45.0, c:28.0, fiber:10.0, kcal:562 },
    units:[{k:'g',label:'克',g:1},{k:'handful',label:'把',g:30}], tags:[], note:'' },
  { id:'hazelnut', name:'榛子', cat:'nut', base:'cooked', yield:1,
    n:{ p:15.0, f:61.0, c:17.0, fiber:10.0, kcal:628 },
    units:[{k:'g',label:'克',g:1},{k:'handful',label:'把',g:25}], tags:[], note:'' }
];

/* 各分类的「其他手动输入」占位项 */
window.OTHER_FOODS = [
  { id:'other_protein', name:'其他蛋白', cat:'protein', base:'cooked', yield:1,
    n:{ p:20, f:5, c:0, fiber:0, kcal:130 },
    units:[{k:'g',label:'克',g:1}], tags:[], note:'请在食物库里录入真实营养' },
  { id:'other_fat', name:'其他脂肪', cat:'fat', base:'cooked', yield:1,
    n:{ p:0, f:90, c:0, fiber:0, kcal:810 },
    units:[{k:'g',label:'克',g:1}], tags:['visibleFat'], note:'' },
  { id:'other_carb', name:'其他碳水', cat:'carb', base:'cooked', yield:1,
    n:{ p:3, f:1, c:30, fiber:2, kcal:141 },
    units:[{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'other_vege', name:'其他蔬菜', cat:'vege', base:'cooked', yield:1,
    n:{ p:2.0, f:0.3, c:5.0, fiber:2.5, kcal:32 },
    units:[{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'other_fruit', name:'其他水果', cat:'fruit', base:'cooked', yield:1,
    n:{ p:0.5, f:0.2, c:12, fiber:1.5, kcal:52 },
    units:[{k:'g',label:'克',g:1}], tags:[], note:'' },
  { id:'other_nut', name:'其他坚果', cat:'nut', base:'cooked', yield:1,
    n:{ p:18, f:55, c:18, fiber:7, kcal:600 },
    units:[{k:'g',label:'克',g:1}], tags:[], note:'' },
];

/* 生熟营养无差异的食物（奶/果/坚果/油/补剂等），切换生熟结果相同 */
window.STATE_INSENSITIVE = new Set(
  window.FOOD_DB.filter(f => f.yield === 1).map(f => f.id)
);

/* ============================================================
 * 餐次：用于「每餐 30-45g 蛋白均匀分布」的检查
 * 训练日带围训练期节点，休息日自动隐藏练前/练后
 * ============================================================ */
window.MEALS = [
  { k: 'breakfast', name: '早餐', icon: 'fa-sun',            trainOnly: false },
  { k: 'pre',       name: '练前', icon: 'fa-bolt',           trainOnly: true  },
  { k: 'lunch',     name: '午餐', icon: 'fa-bowl-food',      trainOnly: false },
  { k: 'post',      name: '练后', icon: 'fa-dumbbell',       trainOnly: true  },
  { k: 'dinner',    name: '晚餐', icon: 'fa-moon',           trainOnly: false },
  { k: 'snack',     name: '加餐', icon: 'fa-cookie-bite',    trainOnly: false }
];

/* ============================================================
 * 补缺口建议：把「还差 X g」换算成具体食物与克数
 * 只推荐当餐次适配、且符合当日禁区的食物
 * ============================================================ */
window.FIX_SUGGEST = {
  protein: [
    { id: 'chicken',   label: '去皮鸡胸', fit: ['lunch', 'dinner', 'snack'], cap: 400 },
    { id: 'fish_fw',   label: '淡水鱼肉', fit: ['lunch', 'dinner'], cap: 400 },
    { id: 'salmon',    label: '三文鱼',   fit: ['lunch', 'dinner'], awayOnly: true, cap: 300 },
    { id: 'egg',       label: '水煮蛋',   fit: ['breakfast', 'snack'], cap: 250 },
    { id: 'yogurt',    label: '酸奶',     fit: ['breakfast', 'snack'], cap: 500 },
    { id: 'tuna_can',  label: '金枪鱼罐头', fit: ['lunch', 'snack'], cap: 300 },
    // 补剂密度最高，但单次用量有硬上限，不能被当成"效率最优"排第一
    // cap 45 ≈ 36 g 纯蛋白：肠道单次最高效吸收氨基酸约 30-40 g，超过即被氧化供能
    { id: 'tofu_firm', label: '北豆腐',   fit: ['lunch', 'dinner'], cap: 300 },
    { id: 'protein_powder', label: '蛋白粉', fit: ['pre', 'post'], trainOnly: true, cap: 45 }
  ],
  carb: [
    { id: 'sweet_potato', label: '红薯',   fit: ['breakfast', 'lunch', 'dinner'] },
    { id: 'oats',      label: '燕麦',   fit: ['breakfast'] },
    { id: 'rice',      label: '白米饭', fit: ['lunch', 'post'], fast: true },
    { id: 'pumpkin',   label: '蒸南瓜', fit: ['lunch', 'dinner'] },
    { id: 'chickpeas', label: '鹰嘴豆', fit: ['lunch', 'dinner'], cap: 300 },
    { id: 'red_beans', label: '红豆',   fit: ['lunch', 'dinner'], cap: 300 },
    { id: 'banana',    label: '香蕉',   fit: ['pre', 'post'], fast: true }
  ],
  fat: [
    // awayOnly：训练日也可用，但必须安排在远离训练的餐次（早餐/晚餐），
    // 不能落进 pre / post —— 这与「围训练期零脂肪」的预警口径保持一致。
    { id: 'avocado',   label: '牛油果',   fit: ['lunch', 'dinner'], awayOnly: true },
    { id: 'cheese',    label: '芝士',     fit: ['breakfast', 'snack'], awayOnly: true },
    { id: 'almond',    label: '巴旦木',   fit: ['snack'], awayOnly: true },
    { id: 'walnut',    label: '大核桃',   fit: ['snack'], awayOnly: true },
    { id: 'salmon',    label: '三文鱼',   fit: ['lunch', 'dinner'], awayOnly: true },
    { id: 'pecan',     label: '碧根果',   fit: ['snack', 'dinner'], awayOnly: true, cap: 40 },
    { id: 'olive_oil', label: '橄榄油',   fit: ['lunch', 'dinner'], awayOnly: true, cap: 15 }
  ],
  vege: [
    { id: 'dark_vege', label: '深色蔬菜', fit: ['lunch', 'dinner'] }
  ]
};

/* ============================================================
 * 鼓励卡文案：分档激励
 * ============================================================ */
window.CHEER_TEXTS = {
  perfect: [
    { t: '全项达标！', d: '蛋白、碳水、脂肪、蔬菜全部落位。今天没有一处将就。' },
    { t: '教科书级的一天', d: '这不是运气，是你把每一克都算清楚了。' },
    { t: '闭环完成', d: '训练撕裂、营养修补——两端都做到了。' }
  ],
  good: [
    { t: '主体达标', d: '主要目标已达成，剩下的是锦上添花。' },
    { t: '稳住了', q: 't' },
    { t: '方向正确', d: '大框架已经立住，细节再打磨一天就更顺。' }
  ],
  protein: [
    { t: '蛋白质达标', d: '肌肉修复的原料到位了，这一条是增肌的底线。' },
    { t: '砖块备齐', d: '氨基酸池充盈，不担心分解。' }
  ],
  halfway: [
    { t: '过半了', d: '进度过半，剩下的按同样节奏推完即可。' },
    { t: '正在推进', d: '记录本身就是掌控——继续。' }
  ],
  start: [
    { t: '开张了', d: '第一笔已经记下，今天从现在起有据可依。' },
    { t: '开始记录', d: '能被衡量的，才能被管理。' }
  ]
};
