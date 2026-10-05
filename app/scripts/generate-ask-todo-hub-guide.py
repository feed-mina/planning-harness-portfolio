from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "assets" / "ask-todo-hub-guide.pdf"
FONT = Path("C:/Windows/Fonts/malgun.ttf")
FONT_BOLD = Path("C:/Windows/Fonts/malgunbd.ttf")


def register_fonts() -> tuple[str, str]:
    regular = "Malgun"
    bold = "MalgunBold"
    if FONT.exists() and FONT_BOLD.exists():
        pdfmetrics.registerFont(TTFont(regular, str(FONT)))
        pdfmetrics.registerFont(TTFont(bold, str(FONT_BOLD)))
        return regular, bold
    return "Helvetica", "Helvetica-Bold"


def build() -> None:
    regular, bold = register_fonts()
    blue = colors.HexColor("#2F6FED")
    navy = colors.HexColor("#20304A")
    muted = colors.HexColor("#5D6980")
    soft = colors.HexColor("#F4F7FF")
    line = colors.HexColor("#DCE4F4")

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=13 * mm,
        bottomMargin=12 * mm,
        title="ASK/Todo Hub 빠른 시작",
        author="기획 하네스 루프",
    )
    title = ParagraphStyle("title", fontName=bold, fontSize=21, leading=27, textColor=colors.white)
    subtitle = ParagraphStyle("subtitle", fontName=regular, fontSize=9.5, leading=14, textColor=colors.white)
    heading = ParagraphStyle("heading", fontName=bold, fontSize=11.5, leading=16, textColor=navy, spaceAfter=4)
    body = ParagraphStyle("body", fontName=regular, fontSize=8.6, leading=13, textColor=navy, alignment=TA_LEFT)
    small = ParagraphStyle("small", fontName=regular, fontSize=7.5, leading=11, textColor=muted)
    step = ParagraphStyle("step", fontName=regular, fontSize=8.3, leading=12.5, textColor=navy)

    story = []
    header = Table(
        [[Paragraph("ASK/Todo Hub", title), Paragraph("Windows 빠른 시작 가이드", subtitle)],
         [Paragraph("여러 Git 프로젝트의 ASK/Todo 기록과 실행 시각을 안전하게 관리합니다.", subtitle), ""]],
        colWidths=[120 * mm, 50 * mm],
    )
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), blue),
        ("SPAN", (0, 1), (1, 1)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    story += [header, Spacer(1, 7 * mm)]

    personal = [
        "1. 공개 안내 페이지에서 <b>ASKTodoHub-Setup.exe</b>를 받습니다.",
        "2. 파일명과 SHA256SUMS.txt를 확인한 뒤 설치합니다.",
        "3. 여러 로컬 Git 폴더를 붙여넣거나 상위 폴더에서 검색합니다.",
        "4. Claude/Codex와 09:00, 13:00, 17:30 같은 실행 시각을 정합니다.",
        "5. 등록 결과와 Windows 예약 작업 상태를 확인합니다.",
    ]
    temporary = [
        "1. <b>ASKTodoHub-portable.zip</b>을 받아 원하는 폴더에 풉니다.",
        "2. 시작 화면에서 <b>임시 PC</b>를 선택합니다.",
        "3. 공개 저장소를 clone하거나 기존 Git 폴더를 등록합니다.",
        "4. 임시 모드는 영구 예약 작업을 만들지 않습니다.",
        "5. 종료 전 <b>임시 정리</b>의 dry-run을 확인하고 정리합니다.",
    ]

    def mode_box(name: str, label: str, items: list[str]):
        content = [Paragraph(f"{name} <font color='#2F6FED'>{label}</font>", heading)]
        content += [Paragraph(item, step) for item in items]
        return Table([[content]], colWidths=[83 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), soft),
            ("BOX", (0, 0), (-1, -1), 0.8, line),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]))

    modes = Table([[mode_box("개인 PC", "권장", personal), mode_box("PC방·공용 PC", "임시", temporary)]], colWidths=[86 * mm, 86 * mm])
    modes.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story += [modes, Spacer(1, 5 * mm)]

    story += [Paragraph("Hub가 하는 일", heading)]
    features = [
        ["다중 프로젝트", "폴더 검색·여러 경로 붙여넣기·GitHub HTTPS/SSH clone"],
        ["다중 실행 시각", "프로젝트마다 하루 1~12개 시각, 중복 제거·정렬"],
        ["안전 경계", "PAT/비밀번호 미저장, 사용자 확인 없는 push 금지, 작업 근거만 기록"],
        ["임시 정리", "Hub 소유 marker가 있는 clone·registry·로그만 정리"],
    ]
    feature_table = Table([[Paragraph(f"<b>{a}</b>", body), Paragraph(b, body)] for a, b in features], colWidths=[35 * mm, 137 * mm])
    feature_table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, line),
        ("BACKGROUND", (0, 0), (0, -1), soft),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [feature_table, Spacer(1, 5 * mm)]

    story += [KeepTogether([
        Paragraph("문제가 생기면", heading),
        Paragraph("SmartScreen은 안내 페이지의 파일명과 SHA-256을 먼저 확인합니다. Git이 없으면 Windows용 Git을 설치합니다. 예약 작업 권한이 막히면 관리자 권한을 무조건 요구하지 말고 '지금 캡처'를 사용합니다. 기존 clone 폴더는 덮어쓰지 않습니다.", body),
        Spacer(1, 2.5 * mm),
        Table([[Paragraph("다운로드", heading), Paragraph("harness-meeting-app.kibayerin.workers.dev/ask-todo-hub/", body)],
               [Paragraph("상세 안내", heading), Paragraph("harness-meeting-app.kibayerin.workers.dev/ask-todo-hub/", body)]],
              colWidths=[30 * mm, 142 * mm], style=TableStyle([
                  ("BOX", (0, 0), (-1, -1), 0.8, blue),
                  ("INNERGRID", (0, 0), (-1, -1), 0.4, line),
                  ("LEFTPADDING", (0, 0), (-1, -1), 7),
                  ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                  ("TOPPADDING", (0, 0), (-1, -1), 5),
                  ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
              ])),
        Spacer(1, 2 * mm),
        Paragraph("주의: 임시 PC 종료 후에도 시스템 Git credential helper와 브라우저 로그인은 별도로 로그아웃해야 합니다. 단일 EXE만 복사하지 말고 installer 또는 portable ZIP 전체를 사용하세요.", small),
    ])]

    doc.build(story)


if __name__ == "__main__":
    build()
