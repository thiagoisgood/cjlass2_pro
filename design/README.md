# cjlass2 Pencil 页面设计

本目录包含 cjlass2 的 Pencil 静态页面设计稿。

## 文件

- `cjlass2_pages.pen`：Pencil 可打开的可编辑设计文件。
- `cjlass2_pages_contact_sheet.png`：9 个画板总览图。
- `previews/`：每个画板的单独 PNG 预览。

## 画板

1. `00 Design System`
2. `01 Web 工作台`
3. `02 Web 课表`
4. `03 Web 学员详情`
5. `04 Web 收费管理`
6. `05 Web 通知中心`
7. `06 Web 报表`
8. `07 Mobile 多端入口`
9. `08 Chat 调课确认`

## 打开方式

在 Finder 中双击 `cjlass2_pages.pen`，或使用：

```bash
open -a /Applications/Pencil.app design/cjlass2_pages.pen
```

## 重新生成

```bash
python3 tools/generate_cjlass2_pencil_design.py
```
