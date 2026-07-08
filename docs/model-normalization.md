# Fanz / Vioz 型号归一化表

来源：27 张真实经销商发票（2022–2026，主要柔佛 + 槟城/雪隆/霹雳），2026-07-08 整理。
**本表零客户 PII** —— 只保留型号写法、品牌归属、颜色/尺寸/价格区间。经销商是商号，非客户，故保留。

> 用途：客服 bot 型号→品牌判定（决定保修：**Fanz 马达 10 年 / Vioz 马达 5 年**），以及营销 bot 产品知识。
> ⚠️ Vioz vs Fanz 直接影响保修年限（money）——归一化到 Vioz 的型号请 Edwin 与 Fanz 最终确认后再让 bot 自动判 5 年。

---

## 一、品牌结构（发票实证）

**Vioz 是 Fanz 旗下的低价子品牌/子系列**，不是外部品牌。证据（逐字引用发票行）：
- `FANZ C/F VIOZ WINDY MK II 56" - MATT BLACK`（Luxcent DO，2025-11）
- `FANZ VIOZ 56" CEILING FAN BLACK WINDY-56-MK2`（VS Electrical，2026-01）
- `FANZ-VIOZ CF16 CONNER FAN`（Big Hub，2026-05）
- `FZ-VIOZ C/FAN FF 565`（TPS，2026-01）
- Eberlamp 用 Fanz 库存码 `FANZ000067/069/101`，描述里带 `VIOZ-WINDY`、`VIOZ-VETTA` 别名
- 价格佐证：Vioz 行 RM139–175，远低于 Fanz 主线 DC 扇 RM400–750 —— 符合"低价子线"定位

**V605 是 Fanz 主线型号，不是 Vioz**（纠正此前"V605=Vioz?"的猜测）：
- `FANZ CEILING FAN (MATT BLACK), V605 (MATT BLACK)` @ RM499（Heng Heng，2026-03）—— 逐字标 "FANZ"
- 价格 RM499 属 Fanz 主线区间，非 Vioz 低价区
- 结论：**V605 → 品牌 Fanz → 马达 10 年**。若之前 bot 按 Vioz 判 5 年会少赔/误判。

---

## 二、Fanz 主线型号族（马达 10 年）

| 规范型号族 | 发票里出现的写法（逐字，含变体） | 尺寸 | 说明 |
|---|---|---|---|
| **FS 系列** | `FS 423 N`, `FS 423L`, `Fanz FS423L`, `FANZ-FS 423-L-OAK`, `FS 563 N`, `Fanz FS 563L`, `FANZ-FS 48-L`, `FANZ-FS525N`, `FS525N` | 42"(423)/48"/52"(525)/56"(563) | 遥控 LED 吊扇，最常见主力 |
| **Grande 系列** | `FANZ-GRANDE 523-L-MW/PW`, `Fanz Grande 525L`, `Grande L Series` | 52"(523/525) | Smart LED RC Fan v2 |
| **Aura 系列** | `FANZ-AURA 36L`, `FANZ-AURA 48L/48-L`, `FANZ-48"-AURA`, `AURA Series` | 36"/48" | Smart WiFi + LED |
| **Inno 系列** | `FANZ INNO 435 L`, `FANZ-INNO 435-L-MW` | (435) | Smart LED RC Fan v2 |
| **Eco 系列** | `Fanz Eco 435L` | (435) | 手写单，早期型号 |
| **Axel 系列** | `SERIE AXEL-PINEWOOD`, `Fanz-Fanzo-Axel-W4+PW`, `AXEL-16`（壁扇） | 16"(壁扇) | 含吊扇 + 壁扇 |
| **Gaze 系列** | `GAZE-66N-MB`（描述 `FANZ 66" CEILING FAN 3-BLADE DC`） | 66" | 大尺寸 3 叶 DC |
| **Spinor** | `FANZ-SPINOR-MW`（corner fan） | — | 角扇 |
| **V605** | `V605 (MATT BLACK)`（描述 `FANZ CEILING FAN`） | — | 主线型号，Matt Black |
| **Smart Series** | `Smart Series`（products.js 既有） | — | 通用智能款 |
| **通用/颜色变体** | `FANZ 56" CEILING FAN OAKWOOD-(MAHOGANY)`, `C FAN FANZ WOOD 52'` | 52"/56" | 早期发票只写尺寸+木色 |
| （配件，非扇） | `FANZ AERO WIFI MODULE`, `FANZ-AERO` | — | WiFi 模块，不计入扇型号 |

---

## 三、Vioz 子线型号族（马达 5 年，待 Edwin 最终确认）

| 规范型号族 | 发票里出现的写法（逐字） | 尺寸 | 价格区间 |
|---|---|---|---|
| **Vioz Windy (MK II)** | `VIOZ WINDY MK II`, `WINDY-56-MK2`, `VIOZ-WINDY/56"/MB/DC`, `VIOZ-WINDY/42"/MB/DC`, `MK11 56 MB`(手写,推断) | 42"/56" | RM139–175 |
| **Vioz Vetta** | `VIOZ-VETTA/56N/OAK+MB`, `VETTA-56N` | 56" | ~RM359 |
| **Vioz CF16** | `FANZ-VIOZ CF16 CONNER FAN` | — | ~RM410 |
| **Vioz FF 565** | `FZ-VIOZ C/FAN FF 565` | — | ~RM175 |
| **Vioz（裸写）** | `VIOZ 56" MBK DC 5 BLADES` | 56" | ~RM155 |
| （疑似拼错） | `Vios 56" Ceiling Fan`（手写，价 RM148、56"，疑为 Vioz） | 56" | RM148 |

---

## 四、颜色/尺寸归一化

- **颜色**：`BK`/`Bk`/`Black` → 黑；`Oak`/`Oakwood`/`OAK`/`Mahogany` → 橡木色；`PW`/`Pinewood` → 松木色；`MW`/`Matt White` → 哑白；`MB`/`MBK`/`Matt Black`/`Matte Black` → 哑黑；`W4` → 白（配色代号）
- **尺寸**：型号数字前两位≈英寸（`423`→42"、`523/525`→52"、`563/565`→56"）；`435` 视为型号代号非尺寸；壁/角扇另计（`16"`）
- **描述噪声**：`C/F`=ceiling fan、`C/FAN`=ceiling fan、`CONNER`=corner（拼错）、`RC`=remote control、`DC`=DC 马达、`5B`=5 叶

---

## 五、待确认 / 搞不清的

- `Vios`（Li Leong 手写）：疑 Vioz 拼错，未印品牌，**不确定**
- `MK11 56 MB`（I Bath 手写）：单据写有 "FANZ CUSTOMER SERVICE"，推断 Fanz Windy MK II，**未印品牌，推断**
- `Fanz-Fanzo-Axel`（手写）：Axel 系列的手写变体，"Fanzo" 写法仅此一见
- Eco / Grande 525L 早期手写单价格被划改，**单价不可靠**
- `435` 到底是尺寸还是型号代号：Eco 435L、Inno 435 L 都用 435，倾向"型号代号"，待 Fanz 确认
