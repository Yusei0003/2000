#!/usr/bin/env python3
"""Garoonの画面キャプチャに、注目箇所を示す注釈を焼き込む。

images/garoon/garoon1〜6.png（無加工のキャプチャ）を読み、
画面全体を暗くしたうえで、操作する場所だけを明るく浮かび上がらせ、
矢印と番号を描いた images/garoon/step*.png を書き出す。

    python3 docs/manual/annotate.py

キャプチャを撮り直したときは、下の TARGETS の座標も直すこと。
座標はキャプチャの左上を原点とするピクセル値。
"""
import os
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'images', 'garoon')
FONT = '/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf'

ORANGE = (243, 146, 27)
MAGENTA = (214, 18, 133)
DIM = 0.62          # 暗転の強さ（小さいほど暗い。暗くしすぎると周りが読めなくなる）


def spotlight(im, rects, pad=14, blur=16):
    """rects の範囲だけ元の明るさで残し、それ以外を暗くする。"""
    dim = ImageEnhance.Brightness(im).enhance(DIM)
    mask = Image.new('L', im.size, 0)
    d = ImageDraw.Draw(mask)
    for (x1, y1, x2, y2) in rects:
        d.rounded_rectangle((x1 - pad, y1 - pad, x2 + pad, y2 + pad), radius=10, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return Image.composite(im, dim, mask)


def glow(im, rects, pad=14, width=5):
    """スポットライトの縁に白い光をのせる。"""
    layer = Image.new('L', im.size, 0)
    d = ImageDraw.Draw(layer)
    for (x1, y1, x2, y2) in rects:
        d.rounded_rectangle((x1 - pad, y1 - pad, x2 + pad, y2 + pad),
                            radius=10, outline=255, width=width)
    layer = layer.filter(ImageFilter.GaussianBlur(7))
    white = Image.new('RGB', im.size, (255, 255, 255))
    return Image.composite(white, im, layer)


def outline(draw, rect, color=ORANGE, pad=7, width=5, radius=8):
    x1, y1, x2, y2 = rect
    draw.rounded_rectangle((x1 - pad, y1 - pad, x2 + pad, y2 + pad),
                           radius=radius, outline=color, width=width)


def arrow(draw, start, end, color=ORANGE, width=26, head=52):
    """太い矢印を引く。start から end へ。"""
    import math
    x1, y1 = start
    x2, y2 = end
    ang = math.atan2(y2 - y1, x2 - x1)
    # 軸（頭の分だけ手前で止める）
    bx, by = x2 - head * math.cos(ang), y2 - head * math.sin(ang)
    draw.line([(x1, y1), (bx, by)], fill=color, width=width)
    # 頭
    h = head * 0.62
    draw.polygon([
        (x2, y2),
        (bx - h * math.sin(ang), by + h * math.cos(ang)),
        (bx + h * math.sin(ang), by - h * math.cos(ang)),
    ], fill=color)


def badge(draw, center, text, color=ORANGE, r=30):
    cx, cy = center
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=color)
    f = ImageFont.truetype(FONT, int(r * 1.25))
    tb = draw.textbbox((0, 0), text, font=f)
    draw.text((cx - (tb[2] - tb[0]) / 2 - tb[0], cy - (tb[3] - tb[1]) / 2 - tb[1]),
              text, font=f, fill=(255, 255, 255))


def cursor(draw, tip, color=MAGENTA, size=70):
    """マウスポインタの形を描く（先端が tip）。"""
    x, y = tip
    s = size / 100.0
    pts = [(0, 0), (0, 96), (26, 72), (43, 108), (60, 100), (43, 64), (74, 60)]
    draw.polygon([(x + px * s, y + py * s) for px, py in pts],
                 fill=color, outline=(255, 255, 255))


# ---- 各ステップの注目箇所（キャプチャ上のピクセル座標） ----
TARGETS = {
    'garoon1.png': dict(out='step1.png', spots=[(10, 214, 88, 240)]),
    'garoon2.png': dict(out='step2a.png', spots=[(14, 241, 92, 261)]),
    'garoon3.png': dict(out='step2b.png', spots=[(256, 188, 356, 214)]),
    'garoon4.png': dict(out='step3.png', spots=[
        (208, 262, 492, 292),      # 標題
        (210, 340, 410, 368),      # 変更する日付
        (208, 415, 370, 445),      # 交代相手氏名
        (214, 501, 348, 537),      # 経路を設定する >>
    ]),
    'garoon5.png': dict(out='step4.png', spots=[
        (20, 295, 440, 440),       # 承認（全員）の行
        (160, 466, 294, 502),      # 内容を確認する >>
    ]),
    'garoon6.png': dict(out='step5.png', spots=[
        (155, 517, 264, 552),      # 申請する
    ]),
}


def main():
    for name, cfg in TARGETS.items():
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            print('見つかりません:', p)
            continue
        im = Image.open(p).convert('RGB')
        w, h = im.size
        im = spotlight(im, cfg['spots'])
        im = glow(im, cfg['spots'])
        d = ImageDraw.Draw(im)

        if name == 'garoon1.png':
            cursor(d, (110, 250), MAGENTA, size=95)
            arrow(d, (330, 430), (135, 275), MAGENTA, width=30, head=58)
            badge(d, (350, 455), '1', MAGENTA, r=34)

        elif name == 'garoon2.png':
            outline(d, cfg['spots'][0])
            arrow(d, (260, 360), (110, 268), ORANGE, width=20, head=42)
            badge(d, (278, 375), '1', ORANGE, r=25)

        elif name == 'garoon3.png':
            outline(d, cfg['spots'][0])
            arrow(d, (470, 290), (370, 222), ORANGE, width=20, head=42)
            badge(d, (487, 302), '2', ORANGE, r=25)

        elif name == 'garoon4.png':
            for r in cfg['spots']:
                outline(d, r)
            arrow(d, (860, 380), (378, 512), ORANGE, width=26, head=54)

        elif name == 'garoon5.png':
            outline(d, cfg['spots'][1])
            arrow(d, (560, 520), (330, 500), ORANGE, width=24, head=48)

        elif name == 'garoon6.png':
            outline(d, cfg['spots'][0])
            # 確認できたことを示すチェック
            d.line([(432, 528), (466, 562), (528, 476)], fill=ORANGE, width=20, joint='curve')

        im.save(os.path.join(SRC, cfg['out']), 'PNG', optimize=True)
        print(cfg['out'], f'{w}x{h}', os.path.getsize(os.path.join(SRC, cfg['out'])) // 1024, 'KB')


if __name__ == '__main__':
    main()
