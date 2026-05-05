---
name: xlsx
description: "在任何以电子表格文件为主要输入或输出的任务中使用本技能。这意味着用户想要：打开、读取、编辑或修复现有的 .xlsx、.xlsm、.csv 或 .tsv 文件（如添加列、计算公式、格式化、制图、清理混乱数据）；从头开始或从其他数据源创建新电子表格；或在表格文件格式之间进行转换。特别是当用户按名称或路径引用电子表格文件时——即使是随口一提（如\"我下载文件夹里的那个 xlsx\"）——并希望对它进行操作或从中生成内容时触发。也用于将混乱的表格数据文件（格式错误的行、错位的标题、垃圾数据）清理或重构为规范的电子表格。交付物必须是电子表格文件。当主要交付物是 Word 文档、HTML 报告、独立 Python 脚本、数据库管道或 Google Sheets API 集成时，即使涉及表格数据，也不要触发。"
license: 专有。完整条款见 LICENSE.txt
---

# 输出要求

## 所有 Excel 文件

### 专业字体
- 除非用户另有指示，对所有交付物使用一致的专业字体（如 Arial、Times New Roman）

### 零公式错误
- 每个 Excel 模型交付时必须包含零公式错误（#REF!、#DIV/0!、#VALUE!、#N/A、#NAME?）

### 保留现有模板（更新模板时）
- 修改文件时研究和精确匹配现有格式、样式和约定
- 绝不对已有既定模式的文件强加标准格式
- 现有模板的约定始终优先于这些指南

## 财务模型

### 颜色编码标准
除非用户或现有模板另有说明

#### 行业标准颜色约定
- **蓝色文字（RGB：0,0,255）**：硬编码输入，以及用户会为不同场景更改的数字
- **黑色文字（RGB：0,0,0）**：所有公式和计算
- **绿色文字（RGB：0,128,0）**：从同一工作簿中其他工作表链接的数据
- **红色文字（RGB：255,0,0）**：指向其他文件的外部链接
- **黄色背景（RGB：255,255,0）**：需要注意的关键假设或需要更新的单元格

### 数字格式标准

#### 必需的格式规则
- **年份**：格式化为文本字符串（如"2024"而非"2,024"）
- **货币**：使用 $#,##0 格式；始终在标题中指定单位（"收入（$mm）"）
- **零值**：使用数字格式使所有零显示为"-"，包括百分比（如"$#,##0；($#,##0)；-"）
- **百分比**：默认为 0.0% 格式（一位小数）
- **倍数**：估值倍数（EV/EBITDA、P/E）格式化为 0.0x
- **负数**：使用括号（123）而非负号 -123

### 公式构建规则

#### 假设条件放置
- 将所有假设条件（增长率、利润率、倍数等）放在单独的假设单元格中
- 在公式中使用单元格引用而非硬编码值
- 示例：使用 =B5*(1+$B$6) 而非 =B5*1.05

#### 公式错误预防
- 验证所有单元格引用正确
- 检查范围中的差一错误
- 确保所有预测期间的公式一致
- 用极端值（零值、负数）测试
- 验证没有意外的循环引用

#### 硬编码的文档化要求
- 在单元格中或旁边注释（如果在表格末尾）。格式："来源：[系统/文档]，[日期]，[具体引用]，[URL（如适用）]"
- 示例：
  - "来源：公司 10-K 年报，FY2024，第 45 页，收入注释，[SEC EDGAR URL]"
  - "来源：公司 10-Q 季报，Q2 2025，附件 99.1，[SEC EDGAR URL]"
  - "来源：Bloomberg 终端，2025/8/15，AAPL US Equity"
  - "来源：FactSet，2025/8/20，一致预期界面"

# XLSX 创建、编辑和分析

## 概述

用户可能要求你创建、编辑或分析 .xlsx 文件的内容。针对不同任务，有不同的工具和工作流可用。

## 重要要求

**LibreOffice 用于公式重新计算**：假设已安装 LibreOffice，可通过 `scripts/recalc.py` 脚本重新计算公式值。该脚本在首次运行时自动配置 LibreOffice，包括在 Unix socket 受限的沙箱环境中（由 `scripts/office/soffice.py` 处理）。

## 读取和分析数据

### 使用 pandas 进行数据分析
对于数据分析、可视化和基本操作，使用 **pandas**，它提供了强大的数据处理能力：

```python
import pandas as pd

# 读取 Excel
df = pd.read_excel('file.xlsx')  # 默认：第一个工作表
all_sheets = pd.read_excel('file.xlsx', sheet_name=None)  # 所有工作表（字典形式）

# 分析
df.head()      # 预览数据
df.info()      # 列信息
df.describe()  # 统计信息

# 写入 Excel
df.to_excel('output.xlsx', index=False)
```

## Excel 文件工作流

## 关键：使用公式，而非硬编码值

**始终使用 Excel 公式，而不是在 Python 中计算值并硬编码。** 这确保电子表格保持动态和可更新性。

### ❌ 错误 - 硬编码计算值
```python
# 糟糕：在 Python 中计算并硬编码结果
total = df['Sales'].sum()
sheet['B10'] = total  # 硬编码 5000

# 糟糕：在 Python 中计算增长率
growth = (df.iloc[-1]['Revenue'] - df.iloc[0]['Revenue']) / df.iloc[0]['Revenue']
sheet['C5'] = growth  # 硬编码 0.15

# 糟糕：Python 计算平均值
avg = sum(values) / len(values)
sheet['D20'] = avg  # 硬编码 42.5
```

### ✅ 正确 - 使用 Excel 公式
```python
# 好：让 Excel 计算总和
sheet['B10'] = '=SUM(B2:B9)'

# 好：增长率为 Excel 公式
sheet['C5'] = '=(C4-C2)/C2'

# 好：使用 Excel 函数计算平均值
sheet['D20'] = '=AVERAGE(D2:D19)'
```

这适用于所有计算——总计、百分比、比率、差异等。电子表格应在源数据更改时能够重新计算。

## 常见工作流
1. **选择工具**：数据处理用 pandas，公式/格式用 openpyxl
2. **创建/加载**：创建工作簿或加载现有文件
3. **修改**：添加/编辑数据、公式和格式
4. **保存**：写入文件
5. **重新计算公式（如果使用公式则必须执行）**：使用 scripts/recalc.py 脚本
   ```bash
   python scripts/recalc.py output.xlsx
   ```
6. **验证并修复任何错误**：
   - 脚本返回包含错误详情的 JSON
   - 如果 `status` 为 `errors_found`，检查 `error_summary` 获取具体错误类型和位置
   - 修复发现的错误并重新计算
   - 需要修复的常见错误：
     - `#REF!`：无效的单元格引用
     - `#DIV/0!`：除零错误
     - `#VALUE!`：公式中数据类型错误
     - `#NAME?`：无法识别的公式名称

### 创建新的 Excel 文件

```python
# 使用 openpyxl 处理公式和格式
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook()
sheet = wb.active

# 添加数据
sheet['A1'] = '你好'
sheet['B1'] = '世界'
sheet.append(['行', '的', '数据'])

# 添加公式
sheet['B2'] = '=SUM(A1:A10)'

# 格式化
sheet['A1'].font = Font(bold=True, color='FF0000')
sheet['A1'].fill = PatternFill('solid', start_color='FFFF00')
sheet['A1'].alignment = Alignment(horizontal='center')

# 列宽
sheet.column_dimensions['A'].width = 20

wb.save('output.xlsx')
```

### 编辑现有的 Excel 文件

```python
# 使用 openpyxl 保留公式和格式
from openpyxl import load_workbook

# 加载现有文件
wb = load_workbook('existing.xlsx')
sheet = wb.active  # 或 wb['SheetName'] 获取特定工作表

# 处理多个工作表
for sheet_name in wb.sheetnames:
    sheet = wb[sheet_name]
    print(f"工作表：{sheet_name}")

# 修改单元格
sheet['A1'] = '新值'
sheet.insert_rows(2)  # 在第 2 行位置插入行
sheet.delete_cols(3)  # 删除第 3 列

# 添加新工作表
new_sheet = wb.create_sheet('新工作表')
new_sheet['A1'] = '数据'

wb.save('modified.xlsx')
```

## 重新计算公式

由 openpyxl 创建或修改的 Excel 文件包含公式字符串但不包含计算值。使用提供的 `scripts/recalc.py` 脚本重新计算公式：

```bash
python scripts/recalc.py <excel_file> [timeout_seconds]
```

示例：
```bash
python scripts/recalc.py output.xlsx 30
```

该脚本：
- 首次运行时自动设置 LibreOffice 宏
- 重新计算所有工作表中的所有公式
- 扫描所有单元格以查找 Excel 错误（#REF!、#DIV/0! 等）
- 返回包含详细错误位置和计数的 JSON
- 可在 Linux 和 macOS 上运行

## 公式验证清单

确保公式正确运行的快速检查：

### 基本验证
- [ ] **测试 2-3 个示例引用**：在构建完整模型前验证它们引用了正确的值
- [ ] **列映射**：确认 Excel 列匹配（如第 64 列 = BL，不是 BK）
- [ ] **行偏移**：记住 Excel 行从 1 开始（DataFrame 第 5 行 = Excel 第 6 行）

### 常见陷阱
- [ ] **NaN 处理**：使用 `pd.notna()` 检查空值
- [ ] **靠右的列**：财务数据通常在 50+ 列
- [ ] **多处匹配**：搜索所有出现，不只是第一个
- [ ] **除零错误**：在公式中使用 `/` 前检查分母（#DIV/0!）
- [ ] **错误引用**：验证所有单元格引用指向预期单元格（#REF!）
- [ ] **跨工作表引用**：使用正确格式（Sheet1!A1）链接工作表

### 公式测试策略
- [ ] **从小开始**：在广泛应用前先对 2-3 个单元格测试公式
- [ ] **验证依赖**：检查公式中引用的所有单元格都存在
- [ ] **测试边界情况**：包括零、负数和非常大的值

### 解读 scripts/recalc.py 输出
脚本返回包含错误详情的 JSON：
```json
{
  "status": "success",           // 或 "errors_found"
  "total_errors": 0,              // 错误总数
  "total_formulas": 42,           // 文件中的公式数量
  "error_summary": {              // 仅当发现错误时存在
    "#REF!": {
      "count": 2,
      "locations": ["Sheet1!B5", "Sheet1!C10"]
    }
  }
}
```

## 最佳实践

### 库选择
- **pandas**：最适合数据分析、批量操作和简单数据导出
- **openpyxl**：最适合复杂格式、公式和 Excel 特定功能

### 使用 openpyxl
- 单元格索引从 1 开始（row=1，column=1 指单元格 A1）
- 使用 `data_only=True` 读取计算值：`load_workbook('file.xlsx', data_only=True)`
- **警告**：如果以 `data_only=True` 打开并保存，公式将被值替换且永久丢失
- 对大文件：使用 `read_only=True` 读取或 `write_only=True` 写入
- 公式会保留但不会求值——使用 scripts/recalc.py 更新值

### 使用 pandas
- 指定数据类型以避免推断问题：`pd.read_excel('file.xlsx', dtype={'id': str})`
- 对大文件，读取特定列：`pd.read_excel('file.xlsx', usecols=['A', 'C', 'E'])`
- 正确处理日期：`pd.read_excel('file.xlsx', parse_dates=['date_column'])`

## 代码风格指南
**重要**：生成用于 Excel 操作的 Python 代码时：
- 编写简洁的 Python 代码，无需不必要的注释
- 避免冗长的变量名和冗余操作
- 避免不必要的 print 语句

**对于 Excel 文件本身**：
- 为包含复杂公式或重要假设的单元格添加注释
- 记录硬编码值的数据来源
- 为关键计算和模型章节添加说明
