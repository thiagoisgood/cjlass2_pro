#!/usr/bin/env python3
"""Generate cjlass2 Pencil design boards and PNG previews.

The installed Pencil desktop app stores projects as editable JSON `.pen` files.
This script creates a multi-board design file plus static previews from one
shared page model.
"""

from __future__ import annotations

import json
import math
import random
import string
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DESIGN_DIR = ROOT / "design"
PREVIEW_DIR = DESIGN_DIR / "previews"
PEN_PATH = DESIGN_DIR / "cjlass2_pages.pen"
CONTACT_SHEET_PATH = DESIGN_DIR / "cjlass2_pages_contact_sheet.png"

FONT_REGULAR = "/System/Library/Fonts/Hiragino Sans GB.ttc"
FONT_FALLBACK = "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"

COLORS = {
    "bg": "#F6F8FB",
    "surface": "#FFFFFF",
    "line": "#E5EAF2",
    "line2": "#D8E0EA",
    "text": "#111827",
    "muted": "#697386",
    "subtle": "#98A2B3",
    "blue": "#1769E8",
    "blue2": "#EAF2FF",
    "green": "#10B981",
    "green2": "#E9F8F3",
    "teal": "#14B8A6",
    "orange": "#F59E0B",
    "orange2": "#FFF4E5",
    "purple": "#8B5CF6",
    "purple2": "#F1ECFF",
    "red": "#F43F5E",
    "red2": "#FFF0F3",
    "cyan": "#0EA5E9",
    "cyan2": "#E8F7FE",
}

NAV = [
    ("工作台", "home"),
    ("课表", "calendar-days"),
    ("学员", "users"),
    ("收费", "wallet-cards"),
    ("通知", "bell"),
    ("报表", "bar-chart-3"),
    ("设置", "settings"),
]


def hex_to_rgba(color: str, alpha: int | None = None) -> tuple[int, int, int, int]:
    color = color.strip("#")
    if len(color) == 8:
        r, g, b, a = tuple(int(color[i : i + 2], 16) for i in range(0, 8, 2))
    else:
        r, g, b = tuple(int(color[i : i + 2], 16) for i in range(0, 6, 2))
        a = 255
    return r, g, b, a if alpha is None else alpha


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    path = FONT_REGULAR if Path(FONT_REGULAR).exists() else FONT_FALLBACK
    return ImageFont.truetype(path, size=size)


def rid() -> str:
    return "".join(random.choice(string.ascii_letters + string.digits) for _ in range(5))


def stroke(fill: str = COLORS["line"], thickness: int = 1) -> dict:
    return {"align": "inside", "thickness": thickness, "fill": fill}


def shadow(color: str = "#11182714", y: int = 8, blur: int = 20) -> dict:
    return {
        "type": "shadow",
        "shadowType": "outer",
        "color": color,
        "offset": {"x": 0, "y": y},
        "blur": blur,
    }


class Board:
    def __init__(self, name: str, width: int, height: int, x: int, y: int = 0):
        self.name = name
        self.width = width
        self.height = height
        self.frame = {
            "type": "frame",
            "id": rid(),
            "x": x,
            "y": y,
            "name": name,
            "clip": True,
            "width": width,
            "height": height,
            "fill": COLORS["bg"],
            "layout": "none",
            "children": [],
        }
        self.image = Image.new("RGB", (width, height), COLORS["bg"])
        self.draw = ImageDraw.Draw(self.image)

    def add(self, obj: dict) -> None:
        self.frame["children"].append(obj)

    def rect(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        fill: str = COLORS["surface"],
        radius: int = 0,
        outline: str | None = None,
        thickness: int = 1,
        name: str = "Rectangle",
        effect: dict | None = None,
    ) -> None:
        if effect:
            self._shadow(x, y, w, h, radius)
        if radius:
            self.draw.rounded_rectangle(
                [x, y, x + w, y + h],
                radius=radius,
                fill=fill,
                outline=outline,
                width=thickness,
            )
        else:
            self.draw.rectangle(
                [x, y, x + w, y + h], fill=fill, outline=outline, width=thickness
            )
        obj = {
            "type": "frame",
            "id": rid(),
            "x": x,
            "y": y,
            "name": name,
            "width": w,
            "height": h,
            "fill": fill,
            "cornerRadius": radius,
            "layout": "none",
        }
        if outline:
            obj["stroke"] = stroke(outline, thickness)
        if effect:
            obj["effect"] = effect
        self.add(obj)

    def line(self, xy: Iterable[int], fill: str = COLORS["line"], width: int = 1) -> None:
        values = list(xy)
        self.draw.line(values, fill=fill, width=width)
        x1, y1, x2, y2 = values
        self.add(
            {
                "type": "path",
                "id": rid(),
                "name": "Line",
                "x": min(x1, x2),
                "y": min(y1, y2),
                "geometry": f"M{x1 - min(x1, x2)} {y1 - min(y1, y2)} L{x2 - min(x1, x2)} {y2 - min(y1, y2)}",
                "stroke": {"thickness": width, "fill": fill},
                "fill": "transparent",
                "width": abs(x2 - x1) or width,
                "height": abs(y2 - y1) or width,
            }
        )

    def ellipse(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        fill: str,
        outline: str | None = None,
        name: str = "Ellipse",
    ) -> None:
        self.draw.ellipse([x, y, x + w, y + h], fill=fill, outline=outline)
        obj = {
            "type": "ellipse",
            "id": rid(),
            "x": x,
            "y": y,
            "name": name,
            "fill": fill,
            "width": w,
            "height": h,
        }
        if outline:
            obj["stroke"] = stroke(outline)
        self.add(obj)

    def text(
        self,
        x: int,
        y: int,
        content: str,
        size: int = 16,
        fill: str = COLORS["text"],
        weight: str = "regular",
        name: str = "Text",
        width: int | None = None,
        line_height: int | None = None,
    ) -> None:
        f = font(size, weight)
        if line_height is None:
            line_height = int(size * 1.45)
        if width:
            content = self._wrap_text(content, f, width)
        self.draw.multiline_text(
            (x, y), content, font=f, fill=fill, spacing=max(2, line_height - size)
        )
        obj = {
            "type": "text",
            "id": rid(),
            "x": x,
            "y": y,
            "name": name,
            "fill": fill,
            "content": content,
            "fontFamily": "Hiragino Sans GB",
            "fontSize": size,
            "fontWeight": "700" if weight == "bold" else "400",
        }
        if width:
            obj["width"] = width
        self.add(obj)

    def icon(
        self,
        x: int,
        y: int,
        name: str,
        size: int = 18,
        fill: str = COLORS["muted"],
    ) -> None:
        self._draw_icon(x, y, name, size, fill)
        self.add(
            {
                "type": "icon_font",
                "id": rid(),
                "x": x,
                "y": y,
                "name": name,
                "width": size,
                "height": size,
                "iconFontName": name,
                "iconFontFamily": "lucide",
                "fill": fill,
            }
        )

    def pill(self, x: int, y: int, label: str, fill: str, text_fill: str, w: int | None = None) -> None:
        if w is None:
            bbox = self.draw.textbbox((0, 0), label, font=font(13))
            w = bbox[2] - bbox[0] + 22
        self.rect(x, y, w, 28, fill=fill, radius=8, outline=None, name=f"Pill {label}")
        self.text(x + 11, y + 5, label, size=13, fill=text_fill, weight="bold")

    def _shadow(self, x: int, y: int, w: int, h: int, r: int) -> None:
        overlay = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        for i, alpha in enumerate([18, 12, 8]):
            dy = 5 + i * 4
            od.rounded_rectangle(
                [x + 2, y + dy, x + w - 2, y + h + dy],
                radius=r,
                fill=(16, 24, 40, alpha),
            )
        self.image = Image.alpha_composite(self.image.convert("RGBA"), overlay).convert("RGB")
        self.draw = ImageDraw.Draw(self.image)

    def _wrap_text(self, content: str, f: ImageFont.FreeTypeFont, max_width: int) -> str:
        lines: list[str] = []
        for source in content.splitlines():
            current = ""
            for ch in source:
                trial = current + ch
                if self.draw.textlength(trial, font=f) <= max_width or not current:
                    current = trial
                else:
                    lines.append(current)
                    current = ch
            if current:
                lines.append(current)
        return "\n".join(lines)

    def _draw_icon(self, x: int, y: int, name: str, size: int, fill: str) -> None:
        d = self.draw
        c = fill
        x2, y2 = x + size, y + size
        lw = max(2, size // 10)
        if name in {"home", "building-2"}:
            d.line([(x + size * 0.15, y + size * 0.45), (x + size * 0.5, y + size * 0.16), (x + size * 0.85, y + size * 0.45)], fill=c, width=lw)
            d.rounded_rectangle([x + size * 0.25, y + size * 0.42, x + size * 0.75, y + size * 0.84], radius=3, outline=c, width=lw)
        elif "calendar" in name:
            d.rounded_rectangle([x + 2, y + 4, x2 - 2, y2 - 2], radius=4, outline=c, width=lw)
            d.line([(x + 2, y + size * 0.35), (x2 - 2, y + size * 0.35)], fill=c, width=lw)
            d.line([(x + size * 0.32, y + 1), (x + size * 0.32, y + 7)], fill=c, width=lw)
            d.line([(x + size * 0.68, y + 1), (x + size * 0.68, y + 7)], fill=c, width=lw)
        elif name in {"users", "user", "contact"}:
            d.ellipse([x + size * 0.36, y + size * 0.18, x + size * 0.64, y + size * 0.46], outline=c, width=lw)
            d.arc([x + size * 0.22, y + size * 0.45, x + size * 0.78, y + size * 0.92], 200, 340, fill=c, width=lw)
        elif "wallet" in name:
            d.rounded_rectangle([x + 2, y + 4, x2 - 2, y2 - 3], radius=4, outline=c, width=lw)
            d.line([(x + size * 0.62, y + size * 0.5), (x2 - 4, y + size * 0.5)], fill=c, width=lw)
        elif name in {"bell", "bell-ring"}:
            d.arc([x + 4, y + 4, x2 - 4, y2 - 2], 190, 350, fill=c, width=lw)
            d.line([(x + 5, y + size * 0.72), (x2 - 5, y + size * 0.72)], fill=c, width=lw)
            d.ellipse([x + size * 0.43, y + size * 0.78, x + size * 0.57, y + size * 0.92], fill=c)
        elif "bar-chart" in name:
            for i, h in enumerate([0.38, 0.62, 0.82]):
                bx = x + 3 + i * size * 0.27
                d.rounded_rectangle([bx, y2 - 3 - size * h, bx + size * 0.16, y2 - 3], radius=2, fill=c)
        elif name == "settings":
            d.ellipse([x + 4, y + 4, x2 - 4, y2 - 4], outline=c, width=lw)
            d.ellipse([x + size * 0.42, y + size * 0.42, x + size * 0.58, y + size * 0.58], fill=c)
        elif name == "search":
            d.ellipse([x + 2, y + 2, x + size * 0.68, y + size * 0.68], outline=c, width=lw)
            d.line([(x + size * 0.62, y + size * 0.62), (x2 - 2, y2 - 2)], fill=c, width=lw)
        elif name in {"send", "paperclip"}:
            d.polygon([(x + 2, y + size * 0.2), (x2 - 2, y + size * 0.5), (x + 2, y2 - 3), (x + size * 0.35, y + size * 0.5)], outline=c)
            d.line([(x + size * 0.35, y + size * 0.5), (x2 - 3, y + size * 0.5)], fill=c, width=lw)
        elif name in {"check", "circle-check"}:
            d.line([(x + size * 0.18, y + size * 0.55), (x + size * 0.42, y + size * 0.78), (x + size * 0.84, y + size * 0.24)], fill=c, width=lw)
        elif name in {"alert-triangle", "triangle-alert"}:
            d.polygon([(x + size / 2, y + 2), (x2 - 2, y2 - 3), (x + 2, y2 - 3)], outline=c)
            d.line([(x + size / 2, y + size * 0.35), (x + size / 2, y + size * 0.62)], fill=c, width=lw)
        elif name in {"message-circle", "messages-square"}:
            d.rounded_rectangle([x + 2, y + 3, x2 - 2, y2 - 5], radius=6, outline=c, width=lw)
            d.line([(x + size * 0.35, y2 - 5), (x + size * 0.25, y2 - 1)], fill=c, width=lw)
        else:
            d.rounded_rectangle([x + 3, y + 3, x2 - 3, y2 - 3], radius=4, outline=c, width=lw)

    def save_preview(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.image.save(path)


def sidebar(board: Board, active: str) -> None:
    board.rect(0, 0, 232, board.height, fill="#FFFFFF", outline=COLORS["line"], name="Sidebar")
    board.rect(24, 24, 34, 34, fill=COLORS["green"], radius=9, name="Logo")
    board.icon(31, 31, "book-open", 20, "#FFFFFF")
    board.text(70, 28, "晓知教育工作室", size=17, weight="bold")
    board.text(70, 51, "轻量教务与经营", size=11, fill=COLORS["subtle"])
    y = 112
    for label, icon_name in NAV:
        is_active = label == active
        if is_active:
            board.rect(14, y - 10, 204, 54, fill=COLORS["blue2"], radius=10, name=f"Nav {label}")
        board.icon(34, y, icon_name, 21, COLORS["blue"] if is_active else COLORS["muted"])
        board.text(76, y - 2, label, size=17, fill=COLORS["blue"] if is_active else COLORS["text"], weight="bold" if is_active else "regular")
        y += 58
    board.rect(14, board.height - 96, 204, 72, fill="#FFFFFF", radius=10, outline=COLORS["line"], effect=shadow())
    board.icon(28, board.height - 76, "message-circle", 28, COLORS["green"])
    board.text(66, board.height - 80, "从微信接收消息", size=13, fill=COLORS["text"], weight="bold")
    board.text(66, board.height - 58, "在微信中管理通知与审批", size=11, fill=COLORS["muted"])


def topbar(board: Board) -> None:
    board.rect(232, 0, board.width - 232, 66, fill="#FFFFFF", outline=COLORS["line"], name="Topbar")
    board.rect(520, 14, 430, 38, fill="#FFFFFF", radius=9, outline=COLORS["line"])
    board.icon(536, 24, "search", 18, COLORS["subtle"])
    board.text(566, 23, "搜索学员、课程、老师或功能", size=13, fill=COLORS["subtle"])
    board.rect(902, 20, 32, 26, fill="#F2F4F7", radius=6)
    board.text(912, 24, "⌘ K", size=11, fill=COLORS["muted"])
    board.icon(board.width - 250, 24, "bell", 22, COLORS["text"])
    board.ellipse(board.width - 235, 14, 18, 18, COLORS["red"])
    board.text(board.width - 230, 13, "5", size=11, fill="#FFFFFF", weight="bold")
    board.icon(board.width - 190, 24, "message-circle", 22, COLORS["text"])
    board.ellipse(board.width - 124, 16, 36, 36, "#EAD7CF")
    board.text(board.width - 116, 22, "林", size=16, fill=COLORS["text"], weight="bold")
    board.text(board.width - 74, 25, "林老师", size=14, weight="bold")


def stat_card(board: Board, x: int, y: int, w: int, title: str, value: str, icon_name: str, bg: str, fg: str, hint: str = "") -> None:
    board.rect(x, y, w, 104, fill="#FFFFFF", radius=10, outline=COLORS["line"], effect=shadow(y=4, blur=12))
    board.rect(x + 18, y + 24, 48, 48, fill=bg, radius=14)
    board.icon(x + 31, y + 37, icon_name, 22, fg)
    board.text(x + 82, y + 25, title, size=13, fill=COLORS["muted"])
    board.text(x + 82, y + 50, value, size=28, weight="bold")
    if hint:
        board.text(x + 82, y + 82, hint, size=11, fill=COLORS["subtle"])


def desktop_base(name: str, active: str) -> Board:
    board = Board(name, 1448, 1086, x=0)
    sidebar(board, active)
    topbar(board)
    return board


def page_dashboard() -> Board:
    b = desktop_base("01 Web 工作台", "工作台")
    b.text(266, 96, "工作台", size=29, weight="bold")
    stats = [
        ("今日课程", "8", "calendar-days", COLORS["blue2"], COLORS["blue"]),
        ("待点名", "2", "users", COLORS["green2"], COLORS["green"]),
        ("待发送通知", "3", "send", COLORS["orange2"], COLORS["orange"]),
        ("待确认调课", "1", "calendar-clock", COLORS["purple2"], COLORS["purple"]),
        ("即将用完课时", "4", "clock", COLORS["orange2"], COLORS["orange"]),
        ("逾期账单", "2", "wallet-cards", COLORS["red2"], COLORS["red"]),
    ]
    for i, item in enumerate(stats):
        stat_card(b, 266 + i * 194, 148, 176, *item)

    b.rect(266, 282, 616, 504, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(288, 304, "今日待办", size=20, weight="bold")
    b.text(792, 309, "全部待办 〉", size=13, fill=COLORS["blue"])
    tabs = [("全部 7", COLORS["blue2"], COLORS["blue"]), ("学员 3", "#FFFFFF", COLORS["muted"]), ("课程 2", "#FFFFFF", COLORS["muted"]), ("收费 2", "#FFFFFF", COLORS["muted"])]
    tx = 288
    for label, bg, fg in tabs:
        b.rect(tx, 344, 78, 30, fill=bg, radius=8, outline=COLORS["line"])
        b.text(tx + 18, 350, label, size=13, fill=fg, weight="bold" if fg == COLORS["blue"] else "regular")
        tx += 88
    tasks = [
        ("3 位学员课时余额不足", "建议及时提醒学员续费", "users", COLORS["orange2"], COLORS["orange"], "提醒续费"),
        ("2 笔账单已逾期", "总金额 ¥1,680.00", "wallet-cards", COLORS["red2"], COLORS["red"], "去催缴"),
        ("2 节课待记录", "课程已完成，请及时记录课堂反馈", "file-text", COLORS["green2"], COLORS["green"], "去记录"),
        ("1 条调课申请待确认", "学员申请调课，请尽快确认", "calendar-clock", COLORS["purple2"], COLORS["purple"], "去处理"),
    ]
    y = 392
    for title, desc, icon_name, bg, fg, action in tasks:
        b.rect(276, y, 594, 76, fill="#FFFFFF", radius=10, outline=COLORS["line"])
        b.rect(294, y + 20, 36, 36, fill=bg, radius=10)
        b.icon(302, y + 28, icon_name, 20, fg)
        b.text(340, y + 18, title, size=16, weight="bold")
        b.text(340, y + 45, desc, size=12, fill=COLORS["muted"])
        b.text(696, y + 28, "查看", size=13, fill=COLORS["blue"])
        b.rect(766, y + 20, 90, 38, fill=COLORS["blue"], radius=8)
        b.text(786, y + 29, action, size=13, fill="#FFFFFF", weight="bold")
        y += 78
    b.text(498, 726, "收起已完成 (1) ︾", size=13, fill=COLORS["blue"])

    b.rect(898, 282, 518, 504, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(920, 304, "今天课程", size=20, weight="bold")
    b.rect(1224, 302, 86, 28, fill="#F8FAFC", radius=7, outline=COLORS["line"])
    b.text(1240, 307, "全部老师", size=12, fill=COLORS["muted"])
    b.rect(1324, 302, 72, 28, fill="#F8FAFC", radius=7, outline=COLORS["line"])
    b.text(1342, 307, "按时间", size=12, fill=COLORS["muted"])
    b.line([972, 360, 972, 716], fill="#D4E3FF", width=2)
    courses = [
        ("09:00", "初二数学提高班", "林老师", "8 位学生", "进行中", COLORS["green2"], COLORS["green"]),
        ("10:30", "英语口语一对一", "王老师", "李思雨", "进行中", COLORS["green2"], COLORS["green"]),
        ("14:00", "高一物理培优班", "陈老师", "8 位学员", "未开始", COLORS["blue2"], COLORS["blue"]),
        ("16:00", "书法硬笔班", "林老师", "王艺森", "未开始", COLORS["blue2"], COLORS["blue"]),
        ("19:00", "初三化学冲刺班", "陈老师", "6 位学员", "未开始", COLORS["blue2"], COLORS["blue"]),
    ]
    y = 356
    for time, title, teacher, student, status, bg, fg in courses:
        b.text(918, y + 10, time, size=13, fill=COLORS["muted"])
        b.ellipse(966, y + 13, 10, 10, COLORS["blue"])
        b.rect(984, y, 412, 64, fill="#FFFFFF", radius=9, outline=COLORS["line"])
        b.text(1002, y + 14, title, size=15, weight="bold")
        b.icon(1001, y + 40, "user", 14, COLORS["muted"])
        b.text(1022, y + 38, teacher, size=12, fill=COLORS["muted"])
        b.icon(1096, y + 40, "users", 14, COLORS["muted"])
        b.text(1118, y + 38, student, size=12, fill=COLORS["muted"])
        b.pill(1328, y + 12, status, bg, fg)
        y += 80
    b.text(1076, 754, "查看完整课表 〉", size=13, fill=COLORS["blue"])

    b.rect(266, 804, 468, 216, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(288, 824, "最近通知", size=18, weight="bold")
    b.text(642, 828, "全部通知 〉", size=13, fill=COLORS["blue"])
    notices = [("五一期间课程安排调整通知", "课程安排", "04-28 15:30"), ("4月学费缴纳截止提醒", "费用提醒", "04-27 09:15"), ("英语口语班教材更新说明", "课程相关", "04-25 18:45")]
    y = 876
    for title, tag, tm in notices:
        b.ellipse(286, y + 6, 8, 8, COLORS["blue"])
        b.text(304, y, title, size=13, weight="bold")
        b.pill(498, y - 5, tag, COLORS["blue2"] if tag != "费用提醒" else COLORS["green2"], COLORS["blue"] if tag != "费用提醒" else COLORS["green"])
        b.text(626, y, tm, size=13, fill=COLORS["muted"])
        y += 46

    b.rect(752, 804, 664, 216, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(772, 824, "本周数据", size=18, weight="bold")
    b.text(858, 826, "04.28 - 05.04", size=13, fill=COLORS["muted"])
    metrics = [("课时数", "36", "+12", "calendar-days", COLORS["blue"]), ("上课人次", "128", "+15%", "users", COLORS["green"]), ("新增学员", "5", "+2", "user-plus", COLORS["orange"]), ("课消金额", "¥12,680", "+8%", "banknote", COLORS["red"])]
    for i, (label, value, delta, icon_name, color) in enumerate(metrics):
        x = 772 + i * 156
        b.rect(x, 860, 140, 138, fill="#FFFFFF", radius=9, outline=COLORS["line"])
        b.text(x + 16, 882, label, size=13, fill=COLORS["muted"])
        b.text(x + 16, 920, value, size=22, weight="bold")
        b.text(x + 16, 964, "较上周", size=12, fill=COLORS["muted"])
        b.text(x + 64, 964, delta, size=12, fill=COLORS["green"], weight="bold")
        b.icon(x + 102, 918, icon_name, 28, color)
    return b


def page_schedule() -> Board:
    b = desktop_base("02 Web 课表", "课表")
    b.text(266, 96, "课表", size=29, weight="bold")
    b.rect(1106, 92, 116, 38, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.icon(1124, 102, "list-plus", 18, COLORS["text"])
    b.text(1150, 101, "批量排课", size=13, weight="bold")
    b.rect(1236, 92, 118, 38, fill=COLORS["blue"], radius=8)
    b.icon(1252, 102, "plus", 18, "#FFFFFF")
    b.text(1280, 101, "新增课程", size=13, fill="#FFFFFF", weight="bold")
    b.rect(266, 150, 278, 42, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(336, 162, "2024-05-06 ~ 2024-05-12", size=14, weight="bold", fill="#344054")
    b.rect(558, 150, 52, 42, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(572, 162, "本周", size=14, weight="bold")
    b.rect(704, 150, 118, 42, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(734, 162, "全部老师", size=13, fill=COLORS["muted"])
    b.rect(836, 150, 118, 42, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(866, 162, "全部教室", size=13, fill=COLORS["muted"])
    b.rect(266, 210, 786, 756, fill="#FFFFFF", radius=10, outline=COLORS["line"])
    grid_x, grid_y, left_w, head_h = 320, 210, 54, 66
    col_w, row_h = 104, 49
    for i in range(8):
        x = grid_x + i * col_w
        b.line([x, grid_y, x, grid_y + 756], COLORS["line"], 1)
    for i in range(16):
        y = grid_y + head_h + i * row_h
        b.line([266, y, 1052, y], COLORS["line"], 1)
    days = ["05/06\n周一", "05/07\n周二", "05/08\n周三", "05/09\n周四", "05/10\n周五", "05/11\n周六", "05/12\n周日"]
    for i, day in enumerate(days):
        x = grid_x + i * col_w + 34
        b.text(x, 226, day, size=13, fill=COLORS["text"])
    times = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"]
    for i, tm in enumerate(times):
        b.text(276, 288 + i * row_h, tm, size=12, fill=COLORS["muted"])
    b.line([266, 406, 1052, 406], COLORS["red"], 1)
    b.ellipse(314, 401, 10, 10, COLORS["red"])

    def lesson(day: int, start_row: float, rows: float, title: str, sub: str, color: str, border: str | None = None):
        x = grid_x + day * col_w + 6
        y = grid_y + head_h + int(start_row * row_h) + 2
        h = int(rows * row_h) - 4
        b.rect(x, y, col_w - 12, h, fill=color, radius=6, outline=border or color)
        b.text(x + 8, y + 10, title, size=12, weight="bold")
        b.text(x + 8, y + 31, sub, size=11, fill=COLORS["muted"])

    lesson(0, 1, 2, "英语一对一", "小明同学\n王老师｜教室A", "#D9F6EF")
    lesson(1, 3, 2, "初二数学小组课", "3/4\n李老师｜教室B", "#FFE8CC")
    lesson(2, 1, 2, "英语一对一", "小红同学\n王老师｜教室A", "#D9F6EF", COLORS["blue"])
    lesson(2, 6, 2, "书法硬笔班", "6/10\n林老师｜教室C", "#EEE4FF")
    lesson(2, 11, 2, "英语一对一", "小华同学\n王老师｜教室A", "#D9F6EF")
    lesson(3, 1, 2, "英语一对一", "小明同学\n王老师｜教室A", "#D9F6EF")
    lesson(3, 8, 2, "高一物理小组课", "2/4\n陈老师｜教室A", "#FFE8CC")
    lesson(4, 3, 2, "英语一对一", "小雨同学\n王老师｜教室A", "#D9F6EF")
    lesson(4, 12, 1.6, "初三化学冲刺班", "5/12\n陈老师｜教室A", "#EEE4FF")
    lesson(6, 1, 2, "书法毛笔班", "5/8\n林老师｜教室C", "#EEE4FF")
    lesson(6, 6, 2, "初二数学小组课", "4/4\n李老师｜教室B", "#FFE8CC")
    for i, (label, color) in enumerate([("一对一", "#A7F3D0"), ("小组课", "#FED7AA"), ("固定班", "#DDD6FE"), ("已结束", "#D1D5DB"), ("冲突预警", "#FCA5A5")]):
        x = 286 + i * 120
        b.ellipse(x, 986, 10, 10, color)
        b.text(x + 18, 982, label, size=12, fill=COLORS["muted"])

    b.rect(1072, 210, 344, 810, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(1090, 232, "英语一对一", size=21, weight="bold")
    b.pill(1200, 230, "已确认", COLORS["green2"], COLORS["green"])
    b.icon(1382, 232, "x", 20, COLORS["muted"])
    b.text(1090, 270, "05/08（周三）09:00 - 10:00", size=13, fill=COLORS["muted"])
    fields = [("授课老师", "王老师"), ("学员", "小红同学（初二）"), ("教室", "教室A"), ("课程包", "英语一对一 20课时包\n剩余 12 / 20 课时"), ("课程单价", "¥180.00 / 课时"), ("课前提醒", "已开启（提前15分钟）"), ("随堂记录", "未记录")]
    y = 318
    for label, value in fields:
        b.icon(1092, y + 2, "user" if label in {"授课老师", "学员"} else "file-text", 15, COLORS["muted"])
        b.text(1120, y, label, size=13, fill=COLORS["muted"])
        b.text(1204, y, value, size=13, fill=COLORS["text"] if label != "随堂记录" else COLORS["blue"], width=170)
        y += 48 if "\n" in value else 40
    b.text(1090, 572, "到课情况", size=15, weight="bold")
    for i, lab in enumerate(["未开始", "已到课", "缺课"]):
        x = 1090 + i * 106
        b.rect(x, 612, 92, 34, fill=COLORS["blue2"] if i == 0 else "#FFFFFF", radius=7, outline=COLORS["blue"] if i == 0 else COLORS["line"])
        b.text(x + 24, 620, lab, size=13, fill=COLORS["blue"] if i == 0 else COLORS["muted"], weight="bold" if i == 0 else "regular")
    b.text(1090, 680, "操作", size=15, weight="bold")
    ops = ["调课", "取消课程", "发送通知", "更多"]
    for i, op in enumerate(ops):
        b.text(1090 + i * 80, 714, op, size=13, fill=COLORS["muted"])
    b.rect(1090, 746, 306, 104, fill="#FFF7ED", radius=8, outline="#FECACA")
    b.icon(1104, 762, "alert-triangle", 18, COLORS["red"])
    b.text(1132, 760, "存在 1 个时间冲突", size=13, fill=COLORS["red"], weight="bold")
    b.text(1328, 760, "查看详情 〉", size=12, fill=COLORS["blue"])
    b.text(1108, 798, "冲突课程：英语一对一（小明同学）\n05/08 09:30 - 10:30｜教室A", size=12, fill="#7C2D12", width=260)
    b.rect(1090, 864, 306, 94, fill=COLORS["blue2"], radius=8, outline="#BFDBFE")
    b.text(1108, 884, "调课方案预览", size=13, weight="bold")
    b.text(1108, 914, "05/08 09:00 - 10:00  →  05/08 10:30 - 11:30\n教室A｜王老师｜小红同学", size=12, fill=COLORS["muted"], width=250)
    b.rect(1086, 970, 150, 38, fill=COLORS["blue"], radius=8)
    b.text(1124, 980, "确认调课方案", size=13, fill="#FFFFFF", weight="bold")
    b.rect(1248, 970, 150, 38, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(1308, 980, "取消", size=13, fill=COLORS["text"])
    return b


def page_student() -> Board:
    b = desktop_base("03 Web 学员详情", "学员")
    b.text(266, 88, "学员详情", size=27, weight="bold")
    b.text(382, 94, "‹ 返回学员列表", size=13, fill=COLORS["muted"])
    b.rect(266, 126, 1150, 140, fill="#FFFFFF", radius=10, outline=COLORS["line"], effect=shadow())
    b.ellipse(286, 148, 96, 96, "#F2D4C6")
    b.text(318, 176, "张", size=34, weight="bold")
    b.text(410, 150, "张子涵", size=26, weight="bold")
    b.pill(510, 152, "在读学员", COLORS["blue2"], COLORS["blue"])
    b.text(412, 194, "五年级", size=13, fill=COLORS["muted"])
    for i, tag in enumerate(["英语", "数学", "阅读理解"]):
        b.pill(468 + i * 54, 190, tag, COLORS["blue2"], COLORS["blue"])
    b.text(412, 226, "学号     XS20240408\n入学时间 2024-03-15", size=12, fill=COLORS["muted"])
    b.line([680, 160, 680, 248], COLORS["line"])
    b.text(700, 158, "家长信息", size=13, fill=COLORS["muted"], weight="bold")
    b.text(700, 194, "张先生（爸爸）  138 8888 1234", size=13)
    b.text(700, 226, "家长备注  非常配合，学习积极主动。", size=12, fill=COLORS["muted"])
    b.line([952, 160, 952, 248], COLORS["line"])
    b.text(972, 158, "当前授课老师", size=13, fill=COLORS["muted"], weight="bold")
    b.ellipse(972, 188, 40, 40, "#EAD7CF")
    b.text(984, 197, "林", size=16, weight="bold")
    b.text(1024, 190, "林老师（英语）", size=13, weight="bold")
    b.pill(1128, 188, "主班老师", COLORS["blue2"], COLORS["blue"])
    b.text(1024, 216, "自 2024-03-15 起带班", size=12, fill=COLORS["muted"])
    for i, (label, icon_name) in enumerate([("编辑信息", "pencil"), ("发送消息", "message-circle"), ("更多操作", "more-horizontal")]):
        x = 1110 + i * 106
        b.rect(x, 138, 94, 34, fill=COLORS["blue"] if i == 2 else "#FFFFFF", radius=7, outline=COLORS["line"] if i != 2 else None)
        b.text(x + 24, 146, label, size=12, fill="#FFFFFF" if i == 2 else COLORS["text"], weight="bold")
    cards = [
        ("剩余课时", "12", "课时", "有效期至 2024-06-30", COLORS["green2"], COLORS["green"], "课时记录"),
        ("本期课程", "数学培优班（春季）", "共24课时｜已上12课时", "2024-03-01 至 2024-06-30", COLORS["blue2"], COLORS["blue"], "查看课程"),
        ("最近出勤", "3 / 3", "次出勤", "最近一次 04-28（周日）准时", COLORS["orange2"], COLORS["orange"], "查看出勤"),
        ("待缴费用", "¥1,680.00", "共 1 笔待缴", "", COLORS["red2"], COLORS["red"], "查看账单"),
    ]
    for i, (title, v, unit, desc, bg, fg, action) in enumerate(cards):
        x = 266 + i * 296
        b.rect(x, 282, 274, 158, fill=bg, radius=10, outline=fg if i in [0, 3] else "#BFDBFE")
        b.text(x + 14, 298, title, size=14, fill=fg, weight="bold")
        if i == 1:
            b.text(x + 14, 328, v, size=16, weight="bold")
            b.text(x + 14, 356, unit, size=12, fill=COLORS["muted"])
            b.text(x + 14, 378, desc, size=12, fill=COLORS["muted"], width=220)
        elif i == 3:
            b.text(x + 14, 328, v, size=24, weight="bold")
            b.text(x + 14, 366, unit, size=12, fill=COLORS["muted"])
        else:
            b.text(x + 14, 328, v, size=25, weight="bold")
            b.text(x + 86, 340, unit, size=13, fill=COLORS["muted"])
            b.text(x + 14, 368, desc, size=12, fill=COLORS["muted"], width=220)
        b.rect(x + 14, 396, 246, 30, fill="#FFFFFF66", radius=6, outline="#FFFFFF")
        b.text(x + 108, 403, action, size=12, fill=fg, weight="bold")
    b.rect(266, 452, 610, 338, fill="#FFFFFF", radius=10, outline=COLORS["line"])
    tabs = ["概况", "课程", "课时", "出勤", "学习记录", "账单", "沟通", "文件"]
    x = 286
    for i, tab in enumerate(tabs):
        b.text(x, 468, tab, size=13, fill=COLORS["blue"] if i == 0 else COLORS["muted"], weight="bold" if i == 0 else "regular")
        if i == 0:
            b.line([x, 492, x + 40, 492], COLORS["blue"], 3)
        x += 70
    b.text(286, 516, "最近课程记录", size=15, weight="bold")
    rows = [
        ("04-28 周日\n10:30 - 11:30", "英语阅读理解专项训练", "已完成", "课堂表现积极，完成练习质量高。"),
        ("04-26 周五\n19:00 - 20:00", "英语语法强化训练", "已完成", "掌握一般过去时用法，作业完成良好。"),
        ("04-24 周三\n19:00 - 20:00", "英语口语口语练习", "请假", "家长请假（因病），已恢复课时。"),
        ("04-21 周日\n10:30 - 11:30", "英语词汇与拼写训练", "已完成", "复习效果不错，需加强拼写。"),
    ]
    y = 548
    for date, title, status, note in rows:
        b.line([286, y - 10, 858, y - 10], COLORS["line"])
        b.text(286, y, date, size=12, fill="#344054")
        b.text(378, y, title, size=13, weight="bold")
        b.ellipse(512, y + 6, 18, 18, "#EAD7CF")
        b.text(538, y + 2, "林老师", size=12, fill=COLORS["muted"])
        b.pill(590, y - 2, status, COLORS["green2"] if status == "已完成" else COLORS["blue2"], COLORS["green"] if status == "已完成" else COLORS["blue"])
        b.text(652, y + 2, note, size=12, fill=COLORS["muted"], width=190)
        y += 58
    b.rect(266, 796, 610, 196, fill="#FFFFFF", radius=10, outline=COLORS["line"])
    b.text(286, 818, "最新沟通记录", size=15, weight="bold")
    comms = [("家长微信 - 张先生（爸爸）", "谢老师的反馈，我们会在家里加强阅读练习。", "04-27 21:35"), ("课程反馈", "反馈：张子涵 04-26 课堂表现良好，语法掌握进步明显。", "04-26 20:05"), ("电话沟通", "沟通：与家长沟通本周学习情况，建议增加阅读理解练习。", "04-21 11:20")]
    y = 858
    for title, desc, tm in comms:
        b.icon(286, y, "message-circle", 22, COLORS["green"] if "微信" in title else COLORS["blue"])
        b.text(320, y - 2, title, size=13, weight="bold")
        b.text(320, y + 22, desc, size=12, fill=COLORS["muted"], width=380)
        b.text(760, y, tm, size=11, fill=COLORS["muted"])
        y += 48

    b.rect(896, 452, 520, 540, fill="#FFFFFF", radius=10, outline=COLORS["line"])
    b.text(918, 468, "账单与缴费", size=17, weight="bold")
    b.rect(1100, 462, 112, 34, fill=COLORS["blue"], radius=7)
    b.text(1120, 470, "创建续费订单", size=12, fill="#FFFFFF", weight="bold")
    b.rect(1222, 462, 80, 34, fill="#FFFFFF", radius=7, outline=COLORS["line"])
    b.text(1242, 470, "记录收款", size=12)
    b.rect(1312, 462, 82, 34, fill="#FFFFFF", radius=7, outline=COLORS["line"])
    b.text(1330, 470, "发送提醒", size=12)
    b.text(918, 520, "订单信息", size=14, weight="bold")
    b.text(918, 552, "订单编号     SO20240415001\n订单名称     数学培优班（春季）课包\n订单金额     ¥3,680.00\n下单时间     2024-04-15 09:30\n状态         部分已付", size=12, fill=COLORS["muted"])
    b.line([1152, 518, 1152, 654], COLORS["line"])
    b.text(1174, 520, "发票信息", size=14, weight="bold")
    b.text(1174, 552, "发票类型     增值税普通发票\n发票抬头     张先生\n发票金额     ¥2,000.00\n开票状态     已开票\n开票时间     2024-04-16 14:22", size=12, fill=COLORS["muted"])
    b.text(918, 682, "缴费记录", size=14, weight="bold")
    records = [("2024-04-16 14:25", "微信支付", "已收款", "¥2,000.00"), ("2024-04-15 09:45", "银行转账", "已收款", "¥1,000.00"), ("2024-04-15 09:30", "下单创建", "待收款", "¥1,680.00")]
    y = 716
    for date, pay, st, amount in records:
        b.ellipse(920, y + 8, 6, 6, COLORS["green"] if st == "已收款" else COLORS["red"])
        b.text(938, y, date, size=12, fill=COLORS["muted"])
        b.text(1070, y, pay, size=12, fill=COLORS["muted"])
        b.pill(1168, y - 4, st, COLORS["green2"] if st == "已收款" else COLORS["red2"], COLORS["green"] if st == "已收款" else COLORS["red"])
        b.text(1320, y, amount, size=12, fill=COLORS["red"] if st == "待收款" else COLORS["text"])
        y += 34
    b.text(918, 820, "课时流水（近30条）", size=14, weight="bold")
    for i in range(5):
        yy = 858 + i * 26
        b.line([918, yy - 8, 1392, yy - 8], COLORS["line"])
        b.text(918, yy, f"2024-04-{28 - i*2} 10:30", size=11, fill=COLORS["muted"])
        b.text(1048, yy, "上课扣除", size=11, fill=COLORS["muted"])
        b.text(1160, yy, "英语阅读理解专项训练", size=11, fill=COLORS["muted"])
        b.text(1320, yy, "-1", size=11, fill=COLORS["red"])
        b.text(1360, yy, str(12 + i), size=11, fill=COLORS["muted"])
    return b


def page_fees() -> Board:
    b = desktop_base("04 Web 收费管理", "收费")
    b.text(266, 96, "收费管理", size=29, weight="bold")
    b.rect(1166, 92, 112, 38, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(1192, 101, "导出账单", size=13, weight="bold")
    b.rect(1290, 92, 126, 38, fill=COLORS["blue"], radius=8)
    b.icon(1308, 102, "plus", 18, "#FFFFFF")
    b.text(1336, 101, "创建订单", size=13, fill="#FFFFFF", weight="bold")
    metrics = [("本月收入", "¥28,760", "+12.5%", "banknote", COLORS["blue2"], COLORS["blue"]), ("待收款", "¥9,420", "12 笔", "wallet-cards", COLORS["orange2"], COLORS["orange"]), ("逾期账单", "¥3,260", "4 笔", "alert-triangle", COLORS["red2"], COLORS["red"]), ("课消收入", "¥16,880", "+8.3%", "bar-chart-3", COLORS["green2"], COLORS["green"])]
    for i, m in enumerate(metrics):
        stat_card(b, 266 + i * 292, 150, 270, m[0], m[1], m[3], m[4], m[5], m[2])
    b.rect(266, 282, 350, 738, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(288, 304, "待处理", size=19, weight="bold")
    b.pill(370, 304, "逾期优先", COLORS["red2"], COLORS["red"])
    bills = [("张同学", "英语一对一 20课时包", "¥1,680", "逾期 5 天"), ("李同学", "数学培优 10课时包", "¥860", "今天到期"), ("王艺森", "书法硬笔班 12课时", "¥720", "明天到期"), ("刘小雨", "口语一对一续费", "¥2,360", "待确认")]
    y = 358
    for name, desc, amount, tag in bills:
        b.rect(286, y, 310, 100, fill="#FFFFFF", radius=10, outline=COLORS["line"])
        b.ellipse(304, y + 20, 42, 42, "#EAD7CF")
        b.text(318, y + 30, name[:1], size=16, weight="bold")
        b.text(358, y + 16, name, size=15, weight="bold")
        b.text(358, y + 42, desc, size=12, fill=COLORS["muted"])
        b.text(358, y + 70, amount, size=17, fill=COLORS["red"], weight="bold")
        b.pill(496, y + 66, tag, COLORS["red2"] if "逾期" in tag else COLORS["orange2"], COLORS["red"] if "逾期" in tag else COLORS["orange"])
        y += 116
    b.rect(288, 918, 306, 40, fill=COLORS["blue"], radius=8)
    b.text(404, 928, "一键生成催缴草稿", size=13, fill="#FFFFFF", weight="bold")

    b.rect(636, 282, 780, 420, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(658, 304, "订单与收款", size=19, weight="bold")
    b.rect(1078, 300, 140, 34, fill="#FFFFFF", radius=7, outline=COLORS["line"])
    b.text(1110, 308, "全部状态", size=12, fill=COLORS["muted"])
    b.rect(1232, 300, 164, 34, fill="#FFFFFF", radius=7, outline=COLORS["line"])
    b.text(1262, 308, "搜索订单/学员", size=12, fill=COLORS["subtle"])
    headers = ["学员", "订单", "金额", "已收", "状态", "操作"]
    xs = [658, 790, 1010, 1100, 1190, 1310]
    for x, h in zip(xs, headers):
        b.text(x, 362, h, size=12, fill=COLORS["muted"], weight="bold")
    y = 402
    rows = [
        ("张同学", "英语一对一 20课时包", "¥4,800", "¥3,120", "部分已付", "催缴"),
        ("李同学", "数学培优 10课时包", "¥2,600", "¥1,740", "部分已付", "记录收款"),
        ("王艺森", "书法硬笔 12课时", "¥1,920", "¥1,920", "已结清", "查看"),
        ("刘小雨", "口语一对一续费", "¥3,600", "¥0", "待收款", "发送账单"),
        ("陈小舟", "化学冲刺 8课时", "¥2,400", "¥2,400", "已结清", "查看"),
    ]
    for row in rows:
        b.line([658, y - 12, 1394, y - 12], COLORS["line"])
        for i, val in enumerate(row[:4]):
            b.text(xs[i], y, val, size=13, fill=COLORS["text"] if i in [0, 2] else COLORS["muted"], weight="bold" if i == 0 else "regular")
        status = row[4]
        b.pill(xs[4], y - 5, status, COLORS["green2"] if status == "已结清" else COLORS["orange2"], COLORS["green"] if status == "已结清" else COLORS["orange"])
        b.text(xs[5], y, row[5], size=13, fill=COLORS["blue"], weight="bold")
        y += 58

    b.rect(636, 722, 380, 298, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(658, 744, "一句话处理收费", size=18, weight="bold")
    b.rect(658, 790, 336, 76, fill="#F8FAFC", radius=10, outline=COLORS["line"])
    b.text(676, 808, "帮我给张同学生成续费账单，按英语一对一 20 课时包，优惠 200 元。", size=13, fill=COLORS["text"], width=290)
    b.rect(658, 884, 336, 96, fill=COLORS["blue2"], radius=10, outline="#BFDBFE")
    b.text(676, 902, "待确认订单草稿", size=14, weight="bold")
    b.text(676, 932, "应收：¥4,600\n课包：20 课时｜有效期 180 天\n通知：生成微信账单草稿 1 条", size=12, fill=COLORS["muted"])
    b.rect(1028, 722, 388, 298, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(1050, 744, "收款趋势", size=18, weight="bold")
    points = [(1058, 960), (1100, 920), (1140, 930), (1180, 880), (1220, 892), (1260, 846), (1300, 858), (1340, 830), (1382, 786)]
    for i in range(5):
        y = 790 + i * 42
        b.line([1058, y, 1384, y], "#EEF2F7")
    b.line([1058, 960, 1384, 960], COLORS["line"])
    for p1, p2 in zip(points, points[1:]):
        b.line([*p1, *p2], COLORS["blue"], 3)
    for x, y in points:
        b.ellipse(x - 3, y - 3, 6, 6, COLORS["blue"])
    return b


def page_notifications() -> Board:
    b = desktop_base("05 Web 通知中心", "通知")
    b.text(266, 96, "通知中心", size=29, weight="bold")
    b.rect(1186, 92, 112, 38, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(1218, 101, "全部发送", size=13, weight="bold")
    b.rect(1310, 92, 106, 38, fill=COLORS["blue"], radius=8)
    b.text(1338, 101, "新建通知", size=13, fill="#FFFFFF", weight="bold")
    b.rect(266, 150, 360, 870, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(288, 172, "待发送", size=19, weight="bold")
    for i, tab in enumerate(["待发送 3", "已发送", "草稿", "模板"]):
        b.rect(288 + i * 82, 214, 74, 32, fill=COLORS["blue2"] if i == 0 else "#FFFFFF", radius=7, outline=COLORS["line"])
        b.text(302 + i * 82, 222, tab, size=12, fill=COLORS["blue"] if i == 0 else COLORS["muted"], weight="bold" if i == 0 else "regular")
    items = [
        ("调课通知", "周五 16:00 调至 周六 10:00", "张同学家长", COLORS["blue"]),
        ("课堂提醒", "明天课程提醒", "4 位学员", COLORS["green"]),
        ("续费提醒", "张同学课时即将用完", "1 位家长", COLORS["orange"]),
        ("缴费提醒", "逾期账单催缴", "2 位家长", COLORS["red"]),
    ]
    y = 274
    for title, desc, target, color in items:
        b.rect(286, y, 318, 92, fill="#FFFFFF", radius=10, outline=COLORS["line"])
        b.ellipse(304, y + 20, 38, 38, color)
        b.icon(313, y + 29, "bell", 20, "#FFFFFF")
        b.text(356, y + 18, title, size=15, weight="bold")
        b.text(356, y + 44, desc, size=12, fill=COLORS["muted"], width=170)
        b.text(356, y + 68, target, size=12, fill=COLORS["subtle"])
        b.text(546, y + 36, "发送", size=13, fill=COLORS["blue"], weight="bold")
        y += 108
    b.text(288, 740, "常用模板", size=17, weight="bold")
    for i, title in enumerate(["课程调整", "课前提醒", "课后反馈", "续费催缴"]):
        y = 782 + i * 48
        b.rect(288, y, 316, 36, fill="#F8FAFC", radius=7, outline=COLORS["line"])
        b.text(304, y + 9, title, size=13, weight="bold")
        b.text(554, y + 9, "套用", size=12, fill=COLORS["blue"])

    b.rect(646, 150, 770, 530, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(668, 172, "通知编辑", size=19, weight="bold")
    b.rect(668, 218, 344, 42, fill="#F8FAFC", radius=8, outline=COLORS["line"])
    b.text(686, 230, "通知类型：调课通知", size=13, fill=COLORS["muted"])
    b.rect(1030, 218, 170, 42, fill="#F8FAFC", radius=8, outline=COLORS["line"])
    b.text(1048, 230, "发送渠道：微信", size=13, fill=COLORS["muted"])
    b.rect(1218, 218, 176, 42, fill="#F8FAFC", radius=8, outline=COLORS["line"])
    b.text(1236, 230, "接收人：张先生", size=13, fill=COLORS["muted"])
    b.text(668, 288, "消息内容", size=14, weight="bold")
    b.rect(668, 318, 460, 230, fill="#F8FAFC", radius=10, outline=COLORS["line"])
    b.text(690, 340, "张先生您好，张子涵同学原定 05/08（周三）09:00 的英语一对一课程，因老师时间调整，建议改为 05/08（周三）10:30-11:30，教室不变。\n\n请您确认是否方便，如需其他时间也可以回复。", size=15, fill=COLORS["text"], width=410)
    b.rect(1150, 318, 244, 230, fill="#FFFFFF", radius=24, outline=COLORS["line"])
    b.text(1230, 342, "微信预览", size=13, fill=COLORS["muted"])
    b.rect(1174, 382, 190, 112, fill="#D9FDD3", radius=10)
    b.text(1190, 398, "张先生您好，张子涵同学原定 05/08（周三）09:00 的英语一对一课程，建议改为 10:30。", size=12, fill=COLORS["text"], width=156)
    b.rect(668, 580, 112, 40, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(704, 590, "保存草稿", size=13)
    b.rect(792, 580, 112, 40, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(828, 590, "预约发送", size=13)
    b.rect(916, 580, 128, 40, fill=COLORS["blue"], radius=8)
    b.text(956, 590, "立即发送", size=13, fill="#FFFFFF", weight="bold")

    b.rect(646, 700, 770, 320, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(668, 722, "发送记录", size=19, weight="bold")
    headers = ["时间", "通知", "接收人", "渠道", "状态"]
    xs = [668, 838, 1030, 1150, 1260]
    for x, h in zip(xs, headers):
        b.text(x, 770, h, size=12, fill=COLORS["muted"], weight="bold")
    rows = [
        ("04-28 15:30", "五一课程安排调整", "全体家长", "微信", "已送达"),
        ("04-27 09:15", "4月学费缴纳截止提醒", "12 位家长", "微信", "已读 9/12"),
        ("04-25 18:45", "英语教材更新说明", "英语班家长", "微信", "已送达"),
        ("04-24 20:05", "课后反馈", "张先生", "微信", "已读"),
    ]
    y = 812
    for row in rows:
        b.line([668, y - 14, 1394, y - 14], COLORS["line"])
        for i, val in enumerate(row):
            b.text(xs[i], y, val, size=13, fill=COLORS["text"] if i == 1 else COLORS["muted"], weight="bold" if i == 1 else "regular")
        y += 48
    return b


def page_reports() -> Board:
    b = desktop_base("06 Web 报表", "报表")
    b.text(266, 96, "报表", size=29, weight="bold")
    b.rect(1174, 92, 116, 38, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(1200, 101, "本月（6月）", size=13)
    b.rect(1304, 92, 112, 38, fill=COLORS["blue"], radius=8)
    b.text(1334, 101, "导出报表", size=13, fill="#FFFFFF", weight="bold")
    metrics = [("收入", "¥28,760", "+12.5%", "banknote", COLORS["blue2"], COLORS["blue"]), ("课消", "96 节", "+8.3%", "calendar-check", COLORS["green2"], COLORS["green"]), ("新学员", "6 人", "+20%", "user-plus", COLORS["orange2"], COLORS["orange"]), ("到课率", "92.4%", "+2.1%", "circle-check", COLORS["purple2"], COLORS["purple"])]
    for i, m in enumerate(metrics):
        stat_card(b, 266 + i * 292, 150, 270, m[0], m[1], m[3], m[4], m[5], m[2])
    b.rect(266, 282, 670, 360, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(288, 304, "收入趋势", size=19, weight="bold")
    chart = [(306, 568), (360, 512), (414, 526), (468, 482), (522, 492), (576, 430), (630, 444), (684, 390), (738, 404), (792, 372), (866, 318)]
    for i in range(5):
        y = 350 + i * 48
        b.line([306, y, 896, y], "#EEF2F7")
        b.text(288, y - 7, f"{30 - i*5}K", size=10, fill=COLORS["subtle"])
    b.line([306, 568, 896, 568], COLORS["line"])
    for p1, p2 in zip(chart, chart[1:]):
        b.line([*p1, *p2], COLORS["blue"], 3)
    for x, y in chart:
        b.ellipse(x - 4, y - 4, 8, 8, COLORS["blue"])
    b.text(326, 590, "6-1", size=11, fill=COLORS["muted"])
    b.text(566, 590, "6-10", size=11, fill=COLORS["muted"])
    b.text(760, 590, "6-20", size=11, fill=COLORS["muted"])
    b.text(858, 590, "6-30", size=11, fill=COLORS["muted"])
    b.rect(956, 282, 460, 360, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(978, 304, "课程结构", size=19, weight="bold")
    segments = [("一对一", 0.38, COLORS["green"]), ("小组课", 0.32, COLORS["orange"]), ("固定班", 0.20, COLORS["purple"]), ("试听/其他", 0.10, COLORS["blue"])]
    start = 0
    center = (1098, 455)
    radius = 86
    for label, pct, color in segments:
        end = start + pct * 360
        b.draw.pieslice([center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius], start, end, fill=color)
        start = end
    b.ellipse(center[0] - 48, center[1] - 48, 96, 96, "#FFFFFF")
    b.text(center[0] - 30, center[1] - 18, "96", size=30, weight="bold")
    b.text(center[0] - 26, center[1] + 20, "课时", size=12, fill=COLORS["muted"])
    y = 368
    for label, pct, color in segments:
        b.ellipse(1240, y + 5, 10, 10, color)
        b.text(1260, y, label, size=13, weight="bold")
        b.text(1360, y, f"{int(pct*100)}%", size=13, fill=COLORS["muted"])
        y += 42
    b.rect(266, 662, 520, 358, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(288, 684, "教师课时与课酬", size=19, weight="bold")
    teachers = [("林老师", 36, "¥5,760"), ("王老师", 28, "¥4,480"), ("陈老师", 20, "¥3,200"), ("李老师", 12, "¥1,920")]
    y = 744
    for name, hours, pay in teachers:
        b.text(288, y, name, size=13, weight="bold")
        b.rect(360, y + 3, 260, 12, fill="#EEF2F7", radius=6)
        b.rect(360, y + 3, int(260 * hours / 40), 12, fill=COLORS["blue"], radius=6)
        b.text(642, y, f"{hours} 节", size=13, fill=COLORS["muted"])
        b.text(718, y, pay, size=13, weight="bold")
        y += 58
    b.rect(806, 662, 610, 358, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(828, 684, "经营提醒", size=19, weight="bold")
    insights = [
        ("续费机会", "6 名学员剩余课时低于 3 节，建议本周跟进。", COLORS["orange"], "查看学员"),
        ("到课异常", "书法硬笔班本月请假率 18%，高于机构平均。", COLORS["red"], "查看明细"),
        ("课程增长", "英语一对一收入环比增长 21%，主要来自老生续费。", COLORS["green"], "查看订单"),
        ("教室利用", "教室 A 周三晚间利用率 92%，可考虑调整排课。", COLORS["blue"], "查看课表"),
    ]
    y = 742
    for title, desc, color, action in insights:
        b.rect(828, y, 566, 54, fill="#FFFFFF", radius=9, outline=COLORS["line"])
        b.ellipse(846, y + 19, 12, 12, color)
        b.text(870, y + 12, title, size=14, weight="bold")
        b.text(950, y + 13, desc, size=12, fill=COLORS["muted"], width=300)
        b.text(1328, y + 17, action, size=12, fill=COLORS["blue"], weight="bold")
        y += 68
    return b


def phone_shell(b: Board, x: int, y: int, title: str) -> tuple[int, int]:
    b.rect(x, y, 288, 616, fill="#111827", radius=34, name="Phone shell")
    b.rect(x + 10, y + 12, 268, 592, fill="#FFFFFF", radius=28, outline="#E5E7EB")
    b.text(x + 34, y + 42, "9:41", size=12, weight="bold")
    b.icon(x + 240, y + 76, "bell", 18, COLORS["text"])
    return x + 22, y + 112


def page_mobile() -> Board:
    b = Board("07 Mobile 多端入口", 1536, 1086, x=0)
    b.text(34, 28, "多端入口 · 统一体验 · 高效协同", size=32, weight="bold")
    b.text(34, 76, "网页全局管控中心 + 聊天轻量工作入口 + 家长移动服务入口", size=18, fill="#344054")
    b.rect(32, 128, 600, 450, fill="#FFFFFF", radius=18, outline=COLORS["line"], effect=shadow())
    b.text(78, 150, "网页入口（全局管控中心）", size=18, weight="bold")
    b.text(78, 176, "完整数据视图，精细化管理与配置", size=13, fill=COLORS["muted"])
    b.rect(52, 206, 560, 326, fill="#F8FAFC", radius=12, outline=COLORS["line"])
    mini = page_dashboard()
    preview = mini.image.resize((560, 420))
    b.image.paste(preview.crop((0, 0, 560, 326)), (52, 206))
    b.draw = ImageDraw.Draw(b.image)
    b.rect(32, 598, 600, 180, fill="#FFFFFF", radius=16, outline=COLORS["line"], effect=shadow())
    b.text(78, 620, "快捷工作台（桌面小窗 / 任务看板）", size=18, weight="bold")
    cols = [("需我处理", ["调课申请待确认", "课时余额预警", "课前提醒"]), ("我焦点", ["英语口语一对一 10:30", "高一物理培优 14:00"]), ("待批改", ["钢琴周测", "书法作业"]), ("已完成", ["课后反馈已提交", "通知已发送"])]
    for i, (title, rows) in enumerate(cols):
        x = 52 + i * 140
        b.rect(x, 662, 124, 84, fill="#FFFFFF", radius=8, outline=COLORS["line"])
        b.text(x + 10, 674, title, size=12, weight="bold")
        yy = 700
        for row in rows[:2]:
            b.ellipse(x + 10, yy + 5, 6, 6, COLORS["blue"])
            b.text(x + 24, yy, row, size=10, fill=COLORS["muted"])
            yy += 18

    p1x, p1y = phone_shell(b, 668, 142, "工作台")
    b.text(p1x, p1y - 34, "林老师，上午好", size=18, weight="bold")
    b.text(p1x, p1y - 10, "今天有 3 节课，加油！", size=12, fill=COLORS["muted"])
    b.rect(p1x, p1y + 20, 244, 92, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    for i, (label, value, color) in enumerate([("今日课程", "3/8 节", COLORS["blue"]), ("中阶照名", "2 人", COLORS["green"]), ("待批作业", "1 份", COLORS["orange"]), ("待跟进", "2 条", COLORS["purple"])]):
        x = p1x + 14 + (i % 2) * 112
        y = p1y + 34 + (i // 2) * 42
        b.rect(x, y, 100, 34, fill="#F8FAFC", radius=8)
        b.icon(x + 8, y + 8, "calendar-days" if i == 0 else "users", 16, color)
        b.text(x + 30, y + 8, value, size=12, weight="bold")
        b.text(x + 30, y + 22, label, size=9, fill=COLORS["muted"])
    b.rect(p1x, p1y + 128, 244, 92, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(p1x + 14, p1y + 144, "常用工具", size=13, weight="bold")
    for i, (name, color) in enumerate([("点名", COLORS["green"]), ("布置作业", COLORS["orange"]), ("课后反馈", COLORS["blue"]), ("课程记录", COLORS["purple"])]):
        x = p1x + 16 + i * 56
        b.rect(x, p1y + 172, 40, 40, fill=color, radius=10)
        b.text(x + 9, p1y + 216, name, size=9, fill=COLORS["muted"])
    b.rect(p1x, p1y + 244, 244, 144, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(p1x + 14, p1y + 260, "近期课程", size=13, weight="bold")
    for i, row in enumerate(["10:30 英语口语一对一", "14:00 高一物理培优", "16:30 书法硬笔班"]):
        b.text(p1x + 16, p1y + 292 + i * 34, row, size=12, weight="bold")
        b.pill(p1x + 196, p1y + 286 + i * 34, "进行中" if i == 0 else "未开始", COLORS["green2"] if i == 0 else COLORS["blue2"], COLORS["green"] if i == 0 else COLORS["blue"])

    p2x, p2y = phone_shell(b, 946, 142, "课表与任务")
    b.text(p2x, p2y - 34, "课表与任务", size=19, weight="bold")
    b.text(p2x, p2y - 8, "2025年5月31日 周六", size=12, weight="bold")
    for i, d in enumerate(["29\n周四", "30\n周五", "31\n周六", "1\n周日", "2\n周一"]):
        x = p2x + i * 48
        b.rect(x, p2y + 8, 40, 54, fill=COLORS["green"] if i == 2 else "#F8FAFC", radius=16)
        b.text(x + 10, p2y + 18, d, size=10, fill="#FFFFFF" if i == 2 else COLORS["muted"])
    lessons = [("08:00", "初二数学提高班", "教室 A201（8/12）", "进行中"), ("10:30", "英语口语一对一", "王一诺（1/1）", "进行中"), ("14:00", "高一物理培优", "教室 B302（6/12）", "未开始")]
    y = p2y + 84
    for tm, title, desc, st in lessons:
        b.rect(p2x, y, 244, 82, fill="#FFFFFF", radius=12, outline=COLORS["line"])
        b.text(p2x + 14, y + 14, tm, size=12, weight="bold")
        b.text(p2x + 72, y + 14, title, size=13, weight="bold")
        b.text(p2x + 72, y + 40, desc, size=11, fill=COLORS["muted"])
        b.pill(p2x + 184, y + 14, st, COLORS["green2"] if st == "进行中" else COLORS["blue2"], COLORS["green"] if st == "进行中" else COLORS["blue"])
        y += 94
    b.rect(p2x, p2y + 392, 244, 96, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(p2x + 14, p2y + 408, "待办任务", size=13, weight="bold")
    b.text(p2x + 14, p2y + 440, "2 位学员课时将过期\n3 份作业待批改", size=12, fill=COLORS["muted"])

    p3x, p3y = phone_shell(b, 1230, 142, "家长端")
    b.text(p3x, p3y - 34, "您好，张子涵家长", size=17, weight="bold")
    b.text(p3x, p3y - 10, "陪伴孩子成长，我们一起努力", size=11, fill=COLORS["muted"])
    b.rect(p3x, p3y + 22, 244, 132, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(p3x + 18, p3y + 44, "下一节课", size=13, weight="bold")
    b.text(p3x + 18, p3y + 78, "今天 14:00\n钢琴一对一课", size=18, weight="bold")
    b.rect(p3x + 18, p3y + 112, 94, 34, fill=COLORS["green"], radius=8)
    b.text(p3x + 40, p3y + 121, "查看课表", size=12, fill="#FFFFFF", weight="bold")
    for i, (label, value) in enumerate([("剩余课时", "16.5"), ("待支付", "2"), ("成长积分", "320")]):
        x = p3x + i * 84
        b.rect(x, p3y + 172, 76, 70, fill="#FFFFFF", radius=10, outline=COLORS["line"])
        b.text(x + 12, p3y + 186, label, size=10, fill=COLORS["muted"])
        b.text(x + 12, p3y + 212, value, size=18, weight="bold")
    b.rect(p3x, p3y + 262, 244, 106, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(p3x + 14, p3y + 278, "常用服务", size=13, weight="bold")
    for i, lab in enumerate(["请假申请", "课程调整", "课时购买", "沟通老师"]):
        b.rect(p3x + 16 + i * 56, p3y + 314, 40, 40, fill=[COLORS["purple"], COLORS["orange"], COLORS["red"], COLORS["green"]][i], radius=10)
        b.text(p3x + 12 + i * 56, p3y + 360, lab, size=9, fill=COLORS["muted"])

    b.rect(32, 944, 1472, 96, fill="#FFFFFF", radius=16, outline=COLORS["line"], effect=shadow())
    bottom = [("网页：全局管控中心", "数据全景，精细管理，深度分析", COLORS["blue"]), ("聊天：轻量工作入口", "聚合待办、快捷操作、实时提醒", COLORS["blue"]), ("家长移动端：服务入口", "自助服务，信息透明，沟通顺畅", COLORS["green"]), ("多端数据互通 · 体验一致", "统一账号体系，数据实时同步", COLORS["green"])]
    for i, (title, desc, color) in enumerate(bottom):
        x = 74 + i * 360
        b.ellipse(x, 970, 42, 42, color)
        b.text(x + 58, 972, title, size=15, weight="bold", fill=color)
        b.text(x + 58, 998, desc, size=12, fill=COLORS["muted"])
    return b


def page_chat() -> Board:
    b = Board("08 Chat 调课确认", 980, 760, x=0)
    b.text(44, 36, "聊天入口 · 业务卡片确认", size=28, weight="bold")
    b.text(44, 78, "自然语言只做快捷入口，最终通过可核对业务卡片执行。", size=15, fill=COLORS["muted"])
    b.rect(70, 122, 340, 588, fill="#FFFFFF", radius=28, outline=COLORS["line"], effect=shadow())
    b.text(104, 154, "教务助手", size=18, weight="bold")
    b.icon(354, 154, "more-horizontal", 22, COLORS["text"])
    b.line([70, 194, 410, 194], COLORS["line"])
    b.rect(180, 226, 190, 56, fill="#D9FDD3", radius=10)
    b.text(196, 240, "帮我把今天下午 3:30 的课调到明天下午", size=13, width=150)
    b.ellipse(92, 304, 36, 36, COLORS["blue"])
    b.icon(101, 313, "graduation-cap", 18, "#FFFFFF")
    b.text(142, 308, "好的，为您找到可调整的时间：", size=13, fill=COLORS["muted"])
    b.rect(142, 338, 220, 190, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(160, 360, "调课方案", size=15, weight="bold")
    b.text(160, 398, "原时间：今天 15:30\n新时间：明天 15:30\n课程：钢琴一对一\n冲突检测：无冲突", size=13, fill=COLORS["muted"])
    b.rect(160, 474, 92, 36, fill=COLORS["blue"], radius=8)
    b.text(180, 484, "确认调整", size=12, fill="#FFFFFF", weight="bold")
    b.rect(262, 474, 82, 36, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(282, 484, "修改方案", size=12)
    for i, lab in enumerate(["查看课表", "请假申请", "课堂记录"]):
        b.rect(96 + i * 94, 564, 82, 36, fill="#FFFFFF", radius=8, outline=COLORS["line"])
        b.text(114 + i * 94, 574, lab, size=11)
    b.rect(98, 650, 244, 38, fill="#F8FAFC", radius=19, outline=COLORS["line"])
    b.text(128, 660, "输入消息...", size=12, fill=COLORS["subtle"])

    b.rect(452, 122, 476, 588, fill="#FFFFFF", radius=16, outline=COLORS["line"], effect=shadow())
    b.text(482, 152, "网页同步业务任务", size=20, weight="bold")
    b.pill(748, 152, "待确认", COLORS["orange2"], COLORS["orange"])
    b.text(482, 194, "任务编号 BT-20260623-041", size=12, fill=COLORS["muted"])
    b.rect(482, 234, 416, 122, fill=COLORS["blue2"], radius=12, outline="#BFDBFE")
    b.text(504, 254, "系统理解", size=14, fill=COLORS["blue"], weight="bold")
    b.text(504, 288, "将「钢琴一对一课」从今天 15:30 调整到明天 15:30。涉及 1 节课程、1 名学员、1 名授课老师。", size=15, width=350)
    b.text(482, 388, "确定性校验", size=16, weight="bold")
    checks = [("教师可用", COLORS["green"]), ("学员无冲突", COLORS["green"]), ("教室可用", COLORS["green"]), ("不改变已扣课时", COLORS["green"])]
    for i, (label, color) in enumerate(checks):
        x = 482 + (i % 2) * 210
        y = 430 + (i // 2) * 48
        b.icon(x, y, "circle-check", 18, color)
        b.text(x + 28, y - 2, label, size=14)
    b.text(482, 546, "将产生", size=16, weight="bold")
    b.text(482, 582, "· 修改 1 节课程\n· 生成 2 条通知草稿\n· 在审计流水中记录操作人和入口", size=14, fill=COLORS["muted"])
    b.rect(482, 642, 134, 40, fill=COLORS["blue"], radius=8)
    b.text(516, 652, "确认调课", size=13, fill="#FFFFFF", weight="bold")
    b.rect(628, 642, 118, 40, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(660, 652, "修改内容", size=13)
    b.rect(758, 642, 118, 40, fill="#FFFFFF", radius=8, outline=COLORS["line"])
    b.text(790, 652, "使用表单", size=13)
    return b


def page_design_system() -> Board:
    b = Board("00 Design System", 1200, 800, x=0)
    b.text(52, 44, "cjlass2 页面设计规范", size=30, weight="bold")
    b.text(52, 88, "面向独立教师与小机构的轻量教务系统，AI 隐入业务，只呈现可确认的业务状态。", size=16, fill=COLORS["muted"], width=760)
    swatches = [
        ("Primary Blue", COLORS["blue"]),
        ("Education Green", COLORS["green"]),
        ("Warm Orange", COLORS["orange"]),
        ("Action Purple", COLORS["purple"]),
        ("Risk Red", COLORS["red"]),
        ("Ink", COLORS["text"]),
    ]
    b.text(52, 154, "色彩", size=20, weight="bold")
    for i, (name, color) in enumerate(swatches):
        x = 52 + i * 178
        b.rect(x, 192, 150, 92, fill=color, radius=12)
        b.text(x, 298, name, size=13, weight="bold")
        b.text(x, 320, color, size=12, fill=COLORS["muted"])
    b.text(52, 384, "组件", size=20, weight="bold")
    stat_card(b, 52, 424, 230, "今日课程", "8", "calendar-days", COLORS["blue2"], COLORS["blue"], "查看课表")
    b.rect(312, 424, 340, 104, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.rect(332, 448, 48, 48, fill=COLORS["red2"], radius=14)
    b.icon(345, 461, "wallet-cards", 22, COLORS["red"])
    b.text(394, 444, "2 笔账单已逾期", size=16, weight="bold")
    b.text(394, 474, "总金额 ¥1,680.00", size=13, fill=COLORS["muted"])
    b.rect(548, 456, 86, 36, fill=COLORS["blue"], radius=8)
    b.text(570, 465, "去催缴", size=13, fill="#FFFFFF", weight="bold")
    b.rect(52, 586, 514, 116, fill="#FFFFFF", radius=12, outline=COLORS["line"], effect=shadow())
    b.text(74, 608, "自然语言业务卡片", size=17, weight="bold")
    b.text(74, 646, "系统理解、影响范围、确定性校验、确认执行按钮必须同时出现。", size=14, fill=COLORS["muted"], width=420)
    b.rect(850, 156, 260, 516, fill="#111827", radius=34)
    b.rect(860, 168, 240, 492, fill="#FFFFFF", radius=28)
    b.text(884, 204, "移动端", size=21, weight="bold")
    b.rect(884, 256, 192, 86, fill=COLORS["blue"], radius=12)
    b.text(904, 276, "今日课程", size=13, fill="#FFFFFF")
    b.text(904, 304, "8 节课", size=24, fill="#FFFFFF", weight="bold")
    b.rect(884, 364, 192, 68, fill="#FFFFFF", radius=12, outline=COLORS["line"])
    b.text(902, 386, "待点名", size=13, fill=COLORS["muted"])
    b.text(982, 384, "2 节", size=18, weight="bold")
    return b


def create_boards() -> list[Board]:
    builders = [
        page_design_system,
        page_dashboard,
        page_schedule,
        page_student,
        page_fees,
        page_notifications,
        page_reports,
        page_mobile,
        page_chat,
    ]
    boards: list[Board] = []
    x = 0
    for make in builders:
        board = make()
        board.frame["x"] = x
        boards.append(board)
        x += board.width + 180
    return boards


def save_contact_sheet(boards: list[Board]) -> None:
    thumbs = []
    for b in boards:
        scale = 260 / b.width
        thumbs.append((b, b.image.resize((260, int(b.height * scale)))))
    cols = 3
    gap = 34
    title_h = 42
    cell_w = 260
    cell_h = max(img.height for _, img in thumbs) + title_h
    rows = math.ceil(len(thumbs) / cols)
    sheet = Image.new("RGB", (cols * cell_w + (cols + 1) * gap, rows * cell_h + (rows + 1) * gap), "#F6F8FB")
    d = ImageDraw.Draw(sheet)
    for idx, (b, img) in enumerate(thumbs):
        col = idx % cols
        row = idx // cols
        x = gap + col * (cell_w + gap)
        y = gap + row * (cell_h + gap)
        d.text((x, y), b.name, font=font(16), fill=COLORS["text"])
        sheet.paste(img, (x, y + title_h))
    CONTACT_SHEET_PATH.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(CONTACT_SHEET_PATH)


def main() -> None:
    random.seed(20260623)
    DESIGN_DIR.mkdir(exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    boards = create_boards()
    document = {
        "version": "2.8",
        "children": [board.frame for board in boards],
    }
    PEN_PATH.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    for board in boards:
        filename = board.name.lower().replace(" ", "_").replace("/", "_") + ".png"
        board.save_preview(PREVIEW_DIR / filename)
    save_contact_sheet(boards)
    print(f"Wrote {PEN_PATH}")
    print(f"Wrote previews to {PREVIEW_DIR}")
    print(f"Wrote contact sheet {CONTACT_SHEET_PATH}")


if __name__ == "__main__":
    main()
