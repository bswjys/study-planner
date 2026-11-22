"""장신대 플래너 앱 아이콘 생성기.

토스 블루 그라데이션(#3182F6 → #1B64DA) 배경 위에
"장로회 / 신학대학원 / 합격" 세 줄을 굵은 한글 고딕으로 배치한다.
1024에서 그린 뒤 줄여서 아이폰 홈 화면 아이콘(180px, 60pt)에서도
한눈에 읽히도록 크기·자간·여백을 잡았다.

icon-512-maskable.png 는 안드로이드가 원형으로 잘라도 글자가 잘리지 않도록
같은 그림을 80% 크기로 줄여 놓은 판이다.

    python3 make_icons.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

W = 1024

C1 = (49, 130, 246)    # #3182F6
C2 = (27, 100, 218)    # #1B64DA
WHITE = (255, 255, 255)

FONT_FALLBACKS = [
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
    "/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf",
]

# 세 줄 배치: (글자, 크기, 자간, 세로 중심, 불투명도)
LINES = [
    ("장로회", 116, 18, 300, 235),
    ("신학대학원", 144, 4, 478, 255),
    ("합격", 206, 14, 698, 255),
]
BOLD = 0.045        # 폰트가 Regular뿐이라 stroke로 굵기를 만든다 (크기 대비 비율)
DECOR = (136, 11, 190, 120)  # 위 장식 막대: 너비, 높이, y, 불투명도
MASKABLE_SCALE = 0.80


def font_path():
    for p in FONT_FALLBACKS:
        if os.path.exists(p):
            return p
    raise SystemExit("한글 폰트를 찾지 못했습니다")


def gradient(size):
    """왼쪽 위에서 오른쪽 아래로 가는 그라데이션."""
    small = 128
    g = Image.new("RGB", (small, small))
    px = g.load()
    for y in range(small):
        for x in range(small):
            t = (x + y) / (2 * (small - 1))
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return g.resize((size, size), Image.BICUBIC)


def draw_line(d, txt, fnt, tracking, cy, alpha):
    """가운데 정렬 + 자간 + 살짝 굵게."""
    widths = [fnt.getlength(ch) for ch in txt]
    total = sum(widths) + tracking * (len(txt) - 1)
    x = (W - total) / 2
    stroke = max(1, round(fnt.size * BOLD))
    for ch, w in zip(txt, widths):
        d.text((x, cy), ch, font=fnt, fill=WHITE + (alpha,), anchor="lm",
               stroke_width=stroke, stroke_fill=WHITE + (alpha,))
        x += w + tracking


def draw_content(layer, fp, scale=1.0, ahead=False):
    """글자와 장식을 (가운데 기준) scale 배로 그린다. ahead=True면 대비용 합성."""
    d = ImageDraw.Draw(layer)

    def y(v):
        return W / 2 + (v - W / 2) * scale

    w, h, top, a = DECOR
    w, h = w * scale, h * scale
    d.rounded_rectangle([(W - w) / 2, y(top), (W + w) / 2, y(top) + h],
                        radius=h / 2, fill=WHITE + (a,))

    for txt, size, tracking, cy, alpha in LINES:
        draw_line(d, txt, ImageFont.truetype(fp, round(size * scale)),
                  tracking * scale, y(cy), alpha)


def compose(scale=1.0):
    img = gradient(W).convert("RGBA")
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    draw_content(layer, font_path(), scale)
    return Image.alpha_composite(img, layer).convert("RGB")


def main():
    img = compose(1.0)
    img.save("icon-1024.png")
    for s in (512, 192, 180):
        img.resize((s, s), Image.LANCZOS).save(f"icon-{s}.png")

    maskable = compose(MASKABLE_SCALE)
    maskable.resize((512, 512), Image.LANCZOS).save("icon-512-maskable.png")
    print("ok")


if __name__ == "__main__":
    main()
