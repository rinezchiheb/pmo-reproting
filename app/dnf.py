"""Rapport « Daily New FEAT » (PowerPoint), généré à partir des données de l'outil.

Reprend la structure du rapport quotidien fait à la main (BUILD … _D.N.F_jj.mm.aaaa.pptx), sur la charte du modèle
app/templates/dnf_template.pptx :
  1. couverture ;
  2. vue d'ensemble : une ligne par chantier (météo, avancement, RAF et écart DEV / QA, variation depuis la veille)
     et 3 messages clés par chantier ;
  3. par chantier, la diapositive du daily (CAPA / RAF / écart de la semaine, burndown, RAF par ressource, 4 points
     d'attention au plus), puis le détail par FEAT → US → tâches ouvertes (US et tâches terminées comptées, pas listées)
     et les bogues / TNR ouverts ;
  4. annexes : par chantier, tâches terminées / restantes jour par jour, état des tâches, effort ;
  5. fin.
Allègement du 08/10 : une seule diapositive de synthèse par chantier, tendances en annexe, rien de répété.
CAPA = capacité restante, d'aujourd'hui au jalon (disponible − temps déjà imputé − scrum events, × affectation) :
même définition que l'outil (Synthèse, Capacité, Rapport, burndown) depuis le 13/10/2026.
Météo : mêmes règles que la Synthèse de l'outil (RAF > CAPA : hors capacité ; ≥ 80 % ou retard : sous tension).
Graphiques : graphiques PowerPoint natifs (modifiables, données dans le fichier).
"""
from __future__ import annotations

import io
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION, XL_MARKER_STYLE
from pptx.enum.dml import MSO_LINE_DASH_STYLE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

from . import history

TEMPLATES = Path(__file__).parent / "templates"
# Police du rapport à la place de Corbel (police du modèle) : chiffres alignés, lisibles dans les tableaux ; présente sur tout poste Windows
FONT, FONT_FROM = "Segoe UI", ("Corbel",)
TEMPLATE, LOGO = TEMPLATES / "dnf_template.pptx", TEMPLATES / "dnf_logo.png"

# Couleurs du rapport manuel
INK, MUTED, WHITE = RGBColor(0, 0, 0), RGBColor(0x59, 0x59, 0x59), RGBColor(0xFF, 0xFF, 0xFF)
GREEN_DARK, GREEN, GREEN_LIGHT, GREEN_PALE = RGBColor(0x04, 0x74, 0x17), RGBColor(0x47, 0xD3, 0x59), RGBColor(0x8E, 0xD9, 0x73), RGBColor(0xC1, 0xF0, 0xC8)
OK_TXT, RED, RED_PALE = RGBColor(0x00, 0x8A, 0x3C), RGBColor(0xC0, 0x00, 0x00), RGBColor(0xFD, 0xE2, 0xE2)
AMBER_PALE, BLUE_PALE, GRID = RGBColor(0xFF, 0xF2, 0xCC), RGBColor(0xDD, 0xEB, 0xF7), "BFBFBF"
# Graphiques : DEV en vert de la charte, QA en bleu (logo be-ivs), états des tâches du plus avancé au moins avancé
QA_BLUE, GREY, GREY_LIGHT, PANEL = RGBColor(0x1F, 0x78, 0xB4), RGBColor(0xA6, 0xA6, 0xA6), RGBColor(0xD9, 0xD9, 0xD9), RGBColor(0xF5, 0xF8, 0xF6)
AMBER, AMBER_TXT, RED_MID, BLUE_MID = RGBColor(0xF2, 0xB8, 0x30), RGBColor(0x9C, 0x5B, 0x00), RGBColor(0xE0, 0x5A, 0x5A), RGBColor(0x9D, 0xC3, 0xE6)
SIDE_COLOR = {"dev": GREEN_DARK, "qa": QA_BLUE}
STATES = (("Fini", GREEN_LIGHT), ("Livré", BLUE_MID), ("En cours", AMBER), ("Bloqué", RED_MID), ("À faire", GREY_LIGHT))

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
SIDES = {"dev": "DEV", "qa": "QA"}
MILESTONE = {"dev": "freeze_code", "qa": "fin_test"}
# Lignes de tableau par diapositive (hors en-tête et total) : lignes de 0,27 po, zone utile ~5,85 po
ROWS_PER_SLIDE, ROW_H = 19, 0.27
# Météo (mêmes règles et mots que la Synthèse de l'outil, static/kpi.js)
LV = {"red": 2, "amber": 1, "unknown": 0.5, "green": 0}
WORD = {"red": "Hors capacité", "amber": "Sous tension", "green": "Maîtrisé", "unknown": "Capacité inconnue"}
LVL_STYLE = {"red": (RED, RED_PALE), "amber": (AMBER_TXT, AMBER_PALE), "green": (GREEN_DARK, GREEN_PALE), "unknown": (MUTED, RGBColor(0xEE, 0xEE, 0xEE))}


# ---------------------------------------------------------------- mise en forme
def _d(iso: str | None) -> date | None:
    return date.fromisoformat(iso) if iso else None


def long_date(iso: str | None) -> str:
    d = _d(iso)
    return f"{d.day} {MOIS[d.month - 1]} {d.year}" if d else "—"


def short_date(iso: str | None) -> str:
    return f"{iso[8:10]}/{iso[5:7]}" if iso else ""


def jh(x: float | None, blank_zero: bool = False) -> str:
    if x is None:
        return "—"
    if blank_zero and abs(x) < 0.005:
        return ""
    return f"{x:.2f}".replace(".", ",").replace("-", "−")


def signed(x: float | None) -> str:
    """Variation : +1,00 / −0,50 (zéro sans signe)."""
    if x is None:
        return "—"
    return ("+" if x > 0.005 else "") + jh(0.0 if abs(x) < 0.005 else x)


def pct(x: float | None, signed_: bool = False) -> str:
    if x is None:
        return "—"
    return f"{'+' if signed_ and x > 0.5 else ''}{round(x)} %".replace("-", "−")


def plural(n: int, word: str, many: str | None = None) -> str:
    return f"{n} {word if n <= 1 else (many or word + 's')}"


_side = history.side_of


def _workdays(a: date, b: date) -> int:
    """Jours ouvrés (lundi → vendredi) dans ]a, b]."""
    n, d = 0, a
    while d < b:
        d += timedelta(1)
        n += d.weekday() < 5
    return n


def _fonts(prs: Presentation) -> None:
    """Remplace la police du modèle partout : thème (texte, tableaux et graphiques qui en héritent), masques et dispositions."""
    for m in prs.slide_masters:
        theme = m.part.part_related_by(RT.THEME)
        for old in FONT_FROM:
            theme._blob = theme.blob.replace(f'typeface="{old}"'.encode(), f'typeface="{FONT}"'.encode())
        for el in [m._element] + [lay._element for lay in m.slide_layouts]:
            for tag in ("a:latin", "a:cs"):
                for f in el.iter(qn(tag)):
                    if f.get("typeface") in FONT_FROM:
                        f.set("typeface", FONT)


def _layout(prs: Presentation, name: str):
    return next(l for m in prs.slide_masters for l in m.slide_layouts if l.name == name)


def _slide(prs: Presentation, layout: str, keep: tuple[int, ...] = ()):
    """Nouvelle diapositive ; les espaces réservés inutilisés sont retirés (sinon « Cliquez pour ajouter un titre »)."""
    s = prs.slides.add_slide(_layout(prs, layout))
    for ph in list(s.placeholders):
        if ph.placeholder_format.idx not in keep:
            ph._element.getparent().remove(ph._element)
    return s


def _text(slide, x, y, w, h, lines, size=12, bold=False, color=INK, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP,
          fill=None, shape=None, margin=0.05):
    """Zone de texte (ou forme remplie). lines : liste de lignes ; une ligne = texte ou liste de (texte, {size, bold, color})."""
    if shape or fill is not None:
        box = slide.shapes.add_shape(shape or MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
        box.line.fill.background()
        if fill is not None:
            box.fill.solid(); box.fill.fore_color.rgb = fill
        else:
            box.fill.background()
        box.shadow.inherit = False
    else:
        box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap, tf.vertical_anchor = True, anchor
    tf.margin_left = tf.margin_right = Inches(margin)
    tf.margin_top = tf.margin_bottom = Inches(0.03)
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        for txt, o in ([(line, {})] if isinstance(line, str) else line):
            r = p.add_run()
            r.text = txt
            r.font.size = Pt(o.get("size", size))
            r.font.bold = o.get("bold", bold)
            r.font.color.rgb = o.get("color", color)
    return box


def _border(cell, color: str = GRID, width: int = 6350) -> None:
    tcPr = cell._tc.get_or_add_tcPr()
    for tag in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
        for old in tcPr.findall(qn(tag)):
            tcPr.remove(old)
        ln = tcPr.makeelement(qn(tag), {"w": str(width), "cap": "flat", "cmpd": "sng", "algn": "ctr"})
        fill = ln.makeelement(qn("a:solidFill"), {})
        clr = fill.makeelement(qn("a:srgbClr"), {"val": color})
        fill.append(clr); ln.append(fill)
        tcPr.append(ln)


def _table(slide, x, y, widths, rows, row_h=0.3, size=10):
    """rows : liste de cellules (texte, {bold, color, fill, align, size}). Bordures grises fines, sans style de tableau."""
    shape = slide.shapes.add_table(len(rows), len(widths), Inches(x), Inches(y), Inches(sum(widths)), Inches(row_h * len(rows)))
    t = shape.table
    t.first_row = t.horz_banding = False
    for i, w in enumerate(widths):
        t.columns[i].width = Inches(w)
    for ri, row in enumerate(rows):
        t.rows[ri].height = Inches(row_h)
        for ci in range(len(widths)):
            txt, o = row[ci] if ci < len(row) else ("", {})
            c = t.cell(ri, ci)
            c.margin_left = c.margin_right = Inches(0.05)
            c.margin_top = c.margin_bottom = Inches(0.02)
            c.vertical_anchor = MSO_ANCHOR.MIDDLE
            if o.get("fill") is not None:
                c.fill.solid(); c.fill.fore_color.rgb = o["fill"]
            else:
                c.fill.background()
            _border(c)
            p = c.text_frame.paragraphs[0]
            p.alignment = o.get("align", PP_ALIGN.LEFT)
            r = p.add_run()
            r.text = str(txt)
            r.font.size = Pt(o.get("size", size))
            r.font.bold = o.get("bold", False)
            r.font.color.rgb = o.get("color", INK)
            # marque de fin de paragraphe à la même taille : sinon elle reste à 18 pt et gonfle chaque ligne (~0,34 po)
            p._p.get_or_add_endParaRPr().set("sz", str(int(o.get("size", size) * 100)))
    return shape


def _page_no(slide, n: int) -> None:
    _text(slide, 12.6, 7.12, 0.6, 0.3, [str(n)], size=10, color=MUTED, align=PP_ALIGN.RIGHT)


def _title(slide, txt: str, sub: str | None = None) -> None:
    _text(slide, 0.15, 0.12, 10.5, 0.5, [txt], size=20, bold=True)
    if sub:
        _text(slide, 0.15, 0.58, 10.5, 0.3, [sub], size=11, color=MUTED)


def _weather_pill(slide, st: dict) -> None:
    """Météo du chantier, à droite sous le logo."""
    fg, bg = LVL_STYLE[st["lvl"]]
    _text(slide, 10.35, 0.62, 2.8, 0.34, [[("Météo : ", {"color": fg, "size": 11}), (st["word"], {"bold": True, "color": fg, "size": 11})]],
          fill=bg, shape=MSO_SHAPE.ROUNDED_RECTANGLE, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)


def _chart(slide, kind, x, y, w, h, cats, series, title, colors, *, labels=False, fmt="0.0", legend=True, gap=None):
    """Graphique PowerPoint natif. series : [(nom, valeurs)] ; une valeur None = point absent (jour sans relevé, jour à venir)."""
    cd = CategoryChartData(number_format=fmt)
    cd.categories = cats
    for name, vals in series:
        cd.add_series(name, vals)
    ch = slide.shapes.add_chart(kind, Inches(x), Inches(y), Inches(w), Inches(h), cd).chart
    ch.font.size, ch.font.color.rgb = Pt(9), MUTED
    ch.has_title = True
    tp = ch.chart_title.text_frame.paragraphs[0]
    tp.text = title
    tp.font.size, tp.font.bold, tp.font.color.rgb = Pt(11), True, INK
    ch.has_legend = legend
    if legend:
        ch.legend.position, ch.legend.include_in_layout = XL_LEGEND_POSITION.BOTTOM, False
        ch.legend.font.size = Pt(9)
    line = kind in (XL_CHART_TYPE.LINE, XL_CHART_TYPE.LINE_MARKERS)
    for s, c in zip(ch.plots[0].series, colors):
        if line:
            s.smooth = False
            s.format.line.color.rgb, s.format.line.width = c, Pt(2.25)
            s.marker.style, s.marker.size = XL_MARKER_STYLE.CIRCLE, 6
            s.marker.format.fill.solid(); s.marker.format.fill.fore_color.rgb = c
            s.marker.format.line.color.rgb = c
        else:
            s.format.fill.solid(); s.format.fill.fore_color.rgb = c
    if gap is not None:
        ch.plots[0].gap_width = gap
    if labels:
        pl = ch.plots[0]
        pl.has_data_labels = True
        pl.data_labels.number_format, pl.data_labels.number_format_is_linked = fmt, False
        pl.data_labels.font.size = Pt(9)
        pl.data_labels.font.color.rgb = INK
    va = ch.value_axis
    va.has_major_gridlines = True
    va.major_gridlines.format.line.color.rgb, va.major_gridlines.format.line.width = GREY_LIGHT, Pt(0.5)
    va.format.line.fill.background()
    va.tick_labels.font.size = Pt(8)
    ch.category_axis.tick_labels.font.size = Pt(8)
    ch.category_axis.format.line.color.rgb = GREY
    return ch


def _no_data(slide, x, y, w, h, title, msg) -> None:
    _text(slide, x, y, w, h, [[(title, {"bold": True, "size": 11})], [(msg, {"color": MUTED, "size": 10})]],
          fill=PANEL, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)


# ---------------------------------------------------------------- contenu
def _state(r: dict) -> str:
    """État d'une tâche, regroupé : Fini, Livré (attend la recette), En cours, Bloqué, À faire."""
    st = (r.get("status") or "").lower()
    if r.get("done"):
        return "Fini"
    if "block" in st or "bloqu" in st:
        return "Bloqué"
    if r.get("delivered"):
        return "Livré"
    if "progress" in st or "running" in st:
        return "En cours"
    return "À faire"


def _state_fill(r: dict) -> RGBColor | None:
    return {"Fini": GREEN_LIGHT, "Bloqué": RED_PALE, "Livré": BLUE_PALE, "En cours": AMBER_PALE}.get(_state(r))


def _weather(raf: float, capa: float | None, late: int) -> str:
    """Niveau de météo d'un côté (static/kpi.js weather) : RAF face à la CAPA, et retards / blocages."""
    if raf < 0.005 and not late:
        return "green"
    if capa is None and not late:
        return "unknown"
    ratio = None if capa is None else (100 * raf / capa if capa > 0.005 else math.inf)
    return "red" if ratio is not None and ratio > 100 else "amber" if (ratio is not None and ratio >= 80) or late else "green"


EFFORT_WORD = {"green": "conforme", "amber": "dérive", "red": "forte dérive", "unknown": "rien d'estimé"}


def _effort_of(rows: list[dict]) -> dict[str, dict]:
    """Effort par côté (history.effort) avec l'écart en % : à terminaison (consommé + reste) face à l'estimé initial."""
    out = {}
    for sd, e in history.effort(rows).items():
        out[sd] = {**e, "raf": e["fin"] - e["spent"], "pct": 100 * (e["fin"] - e["est"]) / e["est"] if e["est"] > 0.005 else None}
    return out


def _effort_lvl(e: dict) -> str:
    """Seuils de la page Effort : jusqu'à +5 % conforme, jusqu'à +20 % dérive, au-delà forte dérive ; rien d'estimé : rouge."""
    if e["est"] < 0.005 and e["fin"] < 0.005:
        return "unknown"
    return "red" if e["pct"] is None or e["pct"] > 20 else "amber" if e["pct"] > 5 else "green"


def _effort_sides(eff: dict) -> list[str]:
    return [sd for sd in ("dev", "qa") if eff[sd]["est"] + eff[sd]["fin"] > 0.005]


def _effort_short(eff: dict) -> tuple[str, str]:
    """« +12 % / +1 % » (DEV / QA) et le niveau le plus mauvais des deux."""
    sides = _effort_sides(eff)
    if not sides:
        return "—", "unknown"
    txt = " / ".join(pct(eff[sd]["pct"], True) if eff[sd]["pct"] is not None else "non estimé" for sd in sides)
    if len(sides) == 1:
        txt = f"{SIDES[sides[0]]} {txt}"
    return txt, max((_effort_lvl(eff[sd]) for sd in sides), key=LV.get)


def _sum_side(rows: list[dict], side: str) -> float:
    return sum(r.get(f"raf_{side}") or 0 for r in rows if _side(r) == side)


def _stats(meta: dict, ch: str, rs: list[dict], hist: list[tuple[str, list[dict]]], days: list[dict], today_iso: str) -> dict[str, Any]:
    """Indicateurs d'un chantier au jour du rapport, et leur évolution d'après les relevés quotidiens.
    hist : [(jour, tâches relevées ce jour-là)] du sprint, le jour du rapport en dernier."""
    today = _d(today_iso)
    series = [(d, x) for d, x in ((d, [r for r in rows if r.get("chantier") == ch]) for d, rows in hist) if x]
    prev_day, prev = (series[-2] if len(series) >= 2 and series[-1][0] == today_iso else (None, None))
    cur = next((d for d in days if d["day"] == today_iso and "raf" in d), None)
    st: dict[str, Any] = {"ch": ch, "series": series, "prev_day": prev_day}
    for side in ("dev", "qa"):
        mine = [r for r in rs if _side(r) == side]
        raf = _sum_side(rs, side)
        capa = cur["capa"].get((ch, side)) if cur else None
        late = sum(1 for r in mine if not r.get("done") and _has(r, "RETARD", "BLOQUEE"))
        # rythme : RAF soldé par jour ouvré sur les 3 derniers intervalles entre relevés (réestimations comprises)
        pts = [(_d(d), _sum_side(x, side)) for d, x in series][-4:]
        wd = _workdays(pts[0][0], pts[-1][0]) if len(pts) >= 2 else 0
        vel = (pts[0][1] - pts[-1][1]) / wd if wd else None
        ms = _d(meta.get(MILESTONE[side]))
        eff = _effort_of(rs)[side]
        st[side] = {
            "raf": raf, "raf_prev": _sum_side(prev, side) if prev is not None else None, "capa": capa,
            "gap": capa - raf if capa is not None else None, "late": late, "lvl": _weather(raf, capa, late),
            "vel": vel, "need": raf / vel if vel and vel > 0.005 else None,
            # jours ouvrés d'ici le jalon, jour du rapport compris
            "left": _workdays(today - timedelta(1), ms) if ms and ms >= today else 0, "ms": ms,
            "n": len(mine), "done": sum(1 for r in mine if r.get("done")),
            "effort": eff,
        }
    st["lvl"] = max(st["dev"]["lvl"], st["qa"]["lvl"], key=LV.get)
    st["word"] = "Soldé" if st["lvl"] == "green" and st["dev"]["raf"] + st["qa"]["raf"] < 0.005 else WORD[st["lvl"]]
    work = [r for r in rs if _side(r)]
    st["n"], st["done"] = len(work), sum(1 for r in work if r.get("done"))
    spent, left = sum(r.get("spent_hj") or 0 for r in work), sum(0 if r.get("done") else (r.get("raf_hj") or 0) for r in work)
    st["progress_jh"] = 100 * spent / (spent + left) if spent + left > 0.005 else None
    us: dict[str, bool] = {}
    for r in work:
        if r.get("us_key"):
            us[r["us_key"]] = us.get(r["us_key"], True) and bool(r.get("done"))
    st["us_n"], st["us_done"] = len(us), sum(us.values())
    st["added"] = len(work) - sum(1 for r in prev if _side(r)) if prev is not None else None
    bugs = [r for r in rs if not _side(r)]
    st["bugs_open"] = sum(1 for r in bugs if not r.get("done"))
    st["bugs_prev"] = sum(1 for r in prev if not _side(r) and not r.get("done")) if prev is not None else None
    st["bugs_raf"] = sum(r.get("raf_hj") or 0 for r in bugs if not r.get("done"))
    st["bugs_late"] = sum(1 for r in bugs if not r.get("done") and _has(r, "RETARD"))
    open_ = [r for r in rs if not r.get("done")]
    st["n_late"] = sum(1 for r in open_ if _has(r, "RETARD"))
    st["n_blocked"] = sum(1 for r in open_ if _has(r, "BLOQUEE") or _state(r) == "Bloqué")
    st["n_noest"] = sum(1 for r in open_ if _has(r, "SANS_ESTIMATION", "RAF_A_ESTIMER"))
    st["n_after"] = sum(1 for r in open_ if _has(r, "APRES_FREEZE", "APRES_FIN_TEST"))
    return st


def _has(r: dict, *codes: str) -> bool:
    return any(a["code"] in codes for a in r.get("alerts", []))


def _attention(rs: list[dict], st: dict, meta: dict) -> list[str]:
    """Points d'attention du chantier, du plus grave au moins grave (mêmes alertes que l'outil) ; 4 au plus sur la diapositive."""
    open_ = [r for r in rs if not r.get("done")]

    def keys(xs: list[dict], k: int = 3) -> str:
        return ", ".join(r["key"] for r in xs[:k]) + (" …" if len(xs) > k else "")

    out = []
    for sd in ("dev", "qa"):
        s = st[sd]
        if s["gap"] is not None and s["gap"] < -0.005:
            out.append(f"{SIDES[sd]} : il manque {jh(-s['gap'])} JH de capacité d'ici le {short_date(meta.get(MILESTONE[sd]))}")
        elif s["raf"] > 0.005 and s["gap"] is None and s["need"] is not None and s["need"] > s["left"] + 0.05:
            out.append(f"{SIDES[sd]} : au rythme actuel, {s['need']:.1f} j de travail pour {s['left']} j ouvrés".replace(".", ","))
    for sd in ("dev", "qa"):
        e = st[sd]["effort"]
        if _effort_lvl(e) == "red":
            out.append(f"Effort {SIDES[sd]} : {jh(e['fin'])} JH à terminaison pour {jh(e['est'])} estimés ({pct(e['pct'], True)})"
                       if e["pct"] is not None else f"Effort {SIDES[sd]} : {jh(e['fin'])} JH sans estimation initiale")
    blocked = [r for r in open_ if _has(r, "BLOQUEE") or _state(r) == "Bloqué"]
    if blocked:
        out.append(f"{plural(len(blocked), 'tâche')} bloquée{'s' if len(blocked) > 1 else ''} : {keys(blocked)}")
    late = [r for r in open_ if _has(r, "RETARD")]
    if late:
        out.append(f"{plural(len(late), 'tâche')} en retard : {keys(late)}")
    after = [r for r in open_ if _has(r, "APRES_FREEZE", "APRES_FIN_TEST")]
    if after:
        out.append(f"{plural(len(after), 'échéance')} après la fin de sprint : {keys(after)}")
    noest = [r for r in open_ if _has(r, "SANS_ESTIMATION", "RAF_A_ESTIMER")]
    if noest:
        out.append(f"{plural(len(noest), 'tâche')} sans estimation ou sans RAF : charge absente du RAF")
    left = [r for r in rs if r.get("done") and (r.get("raf_residuel") or 0) > 0.005]
    if left:
        out.append(f"RAF à solder dans Jira sur {plural(len(left), 'tâche finie', 'tâches finies')} ({jh(sum(r['raf_residuel'] for r in left))} JH)")
    return out or ["Aucun point bloquant : pas de retard, pas de blocage."]


def _synthesis(prs, n, meta, ch, rs, days, today_iso, st):
    """La diapositive du daily, une par chantier : CAPA / RAF / écart de la semaine, burndown, RAF par ressource, points d'attention."""
    sl = _slide(prs, "31_Title Slide")
    ms = " · ".join(f"fin {SIDES[sd]} {short_date(meta.get(MILESTONE[sd]))}" for sd in ("dev", "qa") if meta.get(MILESTONE[sd]))
    _title(sl, f"BUILD {meta['sprint']} – {ch}", f"Situation au {long_date(today_iso)}" + (f" · {ms}" if ms else ""))
    _weather_pill(sl, st)

    # ---- CAPA / RAF / écart, jour par jour sur la semaine : un seul tableau, DEV puis QA
    _text(sl, 0.25, 1.0, 6.4, 0.3, ["Capacité et reste à faire de la semaine (JH)"], size=12, bold=True)
    head = [("", {"fill": GREEN_DARK})] + [(short_date(d["day"]), {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.CENTER}) for d in days]
    rows = [head]
    for side in ("dev", "qa"):
        if not st[side]["n"] and st[side]["raf"] < 0.005:
            continue
        fill = GREEN_PALE if side == "dev" else BLUE_PALE
        capa, raf, gap = [(f"CAPA {SIDES[side]}", {"fill": fill})], [(f"RAF {SIDES[side]}", {"bold": True, "fill": fill})], [(f"Écart {SIDES[side]}", {"bold": True, "fill": fill})]
        for d in days:
            c = d.get("capa", {}).get((ch, side)) if "raf" in d else None
            v = d.get("raf", {}).get((ch, side)) if "raf" in d else None
            g = (c - v) if c is not None and v is not None else None
            capa.append((jh(c) if "raf" in d else "", {"align": PP_ALIGN.CENTER, "color": MUTED}))
            raf.append((jh(v) if v is not None else "", {"align": PP_ALIGN.CENTER, "bold": True}))
            gap.append((signed(g) if g is not None else ("—" if "raf" in d else ""),
                        {"align": PP_ALIGN.CENTER, "bold": True, "color": RED if g is not None and g < -0.005 else OK_TXT if g is not None else MUTED}))
        rows += [capa, raf, gap]
    _table(sl, 0.25, 1.33, [1.15] + [5.25 / max(1, len(days))] * len(days), rows, row_h=0.3, size=11)
    y = 1.33 + 0.32 * len(rows) + 0.04
    _text(sl, 0.25, y, 6.4, 0.25, ["CAPA = capacité restante, d'aujourd'hui au jalon · Écart = CAPA − RAF (négatif : ce qui manque)"], size=8.5, color=MUTED)

    # ---- burndown du sprint
    _burndown(sl, meta, st, today_iso, 0.15, y + 0.32, 6.6, 6.98 - (y + 0.32))

    # ---- RAF par ressource (DEV : RAF DEV ; QA : RAF QA ; bogues à part, comme dans la diapositive Bogues et TNR)
    _text(sl, 7.0, 1.0, 6, 0.3, ["RAF par ressource (JH)"], size=12, bold=True)
    per: dict[str, dict[str, float]] = defaultdict(lambda: {"dev": 0.0, "qa": 0.0, "bug": 0.0, "n_dev": 0, "n_qa": 0})
    for r in rs:
        p, sd = per[r.get("assignee") or "Non assignée"], _side(r)
        if sd:
            p[sd] += r.get(f"raf_{sd}") or 0
            p[f"n_{sd}"] += 1
        elif not r.get("done"):
            p["bug"] += r.get("raf_hj") or 0
    rows = [[("Personne", {"bold": True, "color": WHITE, "fill": GREEN_DARK}), ("RAF", {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.RIGHT}),
             ("Bogues", {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.RIGHT})]]
    for side in ("dev", "qa"):
        # seules les personnes qui ont encore quelque chose à faire de ce côté
        people = sorted((name for name, p in per.items() if p[f"n_{side}"] and (p[side] > 0.005 or p["bug"] > 0.005)), key=lambda nm: (-per[nm][side], nm))
        if not people:
            continue
        fill = GREEN_PALE if side == "dev" else BLUE_PALE
        rows.append([(SIDES[side], {"bold": True, "fill": fill}), ("", {"fill": fill}), ("", {"fill": fill})])
        for name in people:
            rows.append([(name, {}), (jh(per[name][side], blank_zero=True), {"align": PP_ALIGN.RIGHT, "bold": True}),
                         (jh(per[name]["bug"], blank_zero=True), {"align": PP_ALIGN.RIGHT, "color": MUTED})])
    if len(rows) == 1:
        rows.append([("Plus aucun reste à faire", {"color": MUTED}), ("", {}), ("", {})])
    row_h = min(0.26, 2.45 / len(rows))
    _table(sl, 7.0, 1.33, [3.6, 1.2, 1.2], rows, row_h=row_h, size=10 if row_h >= 0.24 else 9)

    # ---- effort : planifié (estimé initial) vs consommé + reste, DEV et QA jamais additionnés
    H = {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.RIGHT}
    rows = [[("Effort (JH)", {**H, "align": PP_ALIGN.LEFT})] + [(h, H) for h in ("Estimé", "Consommé", "Reste", "À terminaison", "Dérive")]]
    for sd in _effort_sides({k: st[k]["effort"] for k in ("dev", "qa")}):
        e, R = st[sd]["effort"], {"align": PP_ALIGN.RIGHT}
        fg, bg = LVL_STYLE[_effort_lvl(e)]
        rows.append([(SIDES[sd], {"bold": True, "fill": GREEN_PALE if sd == "dev" else BLUE_PALE}), (jh(e["est"]), R), (jh(e["spent"]), R),
                     (jh(e["raf"]), R), (jh(e["fin"]), {**R, "bold": True}),
                     (pct(e["pct"], True) if e["pct"] is not None else "non estimé", {**R, "bold": True, "color": fg, "fill": bg})])
    if len(rows) == 1:
        rows.append([("Rien d'estimé ni de consommé", {"color": MUTED})] + [("", {})] * 5)
    _table(sl, 7.0, 3.92, [1.15, 0.9, 1.05, 0.85, 1.2, 0.85], rows, row_h=0.27, size=10)
    _text(sl, 7.0, 3.95 + 0.29 * len(rows), 6.0, 0.22, ["À terminaison = consommé + reste · dérive : ≤ 5 % conforme, ≤ 20 % dérive, au-delà forte dérive"],
          size=8, color=MUTED)

    # ---- points d'attention (4 au plus, les plus graves d'abord)
    att = _attention(rs, st, meta)
    more = f"  (+{len(att) - 4} dans l'outil)" if len(att) > 4 else ""
    _text(sl, 7.0, 5.2, 6.0, 1.78, [[("Points d'attention", {"bold": True, "size": 12}), (more, {"size": 9, "color": MUTED})]]
          + [[("• " + a, {"size": 10.5})] for a in att[:4]], fill=PANEL, margin=0.12)
    _page_no(sl, n)


def _delta(x: float | None, unit: str = "", up_is_bad: bool = True) -> tuple[str, dict]:
    """Variation depuis la veille, en rouge quand elle va dans le mauvais sens."""
    if x is None:
        return "—", {"color": MUTED}
    bad = x > 0.005 if up_is_bad else x < -0.005
    good = x < -0.005 if up_is_bad else x > 0.005
    txt = (signed(x) if unit != "n" else (f"+{x:.0f}" if x > 0 else f"{x:.0f}".replace("-", "−") if x < 0 else "0")) + (f" {unit}" if unit and unit != "n" else "")
    return txt, {"color": RED if bad else OK_TXT if good else MUTED, "bold": bad or good}


def _burndown(sl, meta, st, today_iso, x, y, w, h):
    series = st["series"]
    sides = [sd for sd in ("dev", "qa") if st[sd]["n"] or st[sd]["raf"] > 0.005]
    title = "Burndown du RAF (JH) · pointillés : trajectoire idéale jusqu'au jalon"
    if not series or not sides:
        return _no_data(sl, x, y, w, h, title, "Pas de relevé quotidien pour ce chantier")
    first, today = _d(series[0][0]), _d(today_iso)
    end = max([today] + [st[sd]["ms"] for sd in sides if st[sd]["ms"]])
    cats = [first + timedelta(i) for i in range((end - first).days + 1)]
    cats = [d for d in cats if d.weekday() < 5]
    raf = {d: {sd: _sum_side(xs, sd) for sd in sides} for d, xs in series}
    out, colors = [], []
    for sd in sides:
        out.append((f"RAF {SIDES[sd]}", [raf[c.isoformat()][sd] if c.isoformat() in raf else None for c in cats])); colors.append(SIDE_COLOR[sd])
    ideal_from = len(out)
    for sd in sides:
        ms, v0 = st[sd]["ms"], raf[series[0][0]][sd]
        if not ms or ms <= first:
            continue
        k = _workdays(first, ms)
        out.append((f"Idéal {SIDES[sd]}", [round(max(0.0, v0 * (1 - i / k)), 2) if i <= k else None for i in range(len(cats))]))
        colors.append(SIDE_COLOR[sd])
    ch = _chart(sl, XL_CHART_TYPE.LINE_MARKERS, x, y, w, h, [short_date(c.isoformat()) for c in cats], out, title, colors)
    blanks = ch._chartSpace.chart.find(qn("c:dispBlanksAs"))
    if blanks is not None:
        blanks.set("val", "span")
    for s in list(ch.plots[0].series)[ideal_from:]:
        s.format.line.dash_style, s.format.line.width = MSO_LINE_DASH_STYLE.DASH, Pt(1.25)
        s.marker.style = XL_MARKER_STYLE.NONE


def _flow(sl, st, x, y, w, h):
    title = "Tâches DEV / QA : terminées et restantes, jour par jour"
    series = st["series"][-10:]
    if not series:
        return _no_data(sl, x, y, w, h, title, "Pas de relevé quotidien pour ce chantier")
    done = [sum(1 for r in xs if _side(r) and r.get("done")) for _, xs in series]
    left = [sum(1 for r in xs if _side(r) and not r.get("done")) for _, xs in series]
    _chart(sl, XL_CHART_TYPE.COLUMN_STACKED, x, y, w, h, [short_date(d) for d, _ in series],
           [("Terminées", done), ("Restantes", left)], title, [GREEN_LIGHT, GREY_LIGHT], labels=True, fmt="0", gap=55)


def _states(sl, rs, x, y, w, h):
    title = "État des tâches par type (nombre)"
    groups = [("DEV", lambda r: r.get("type_charge") == "DEV"), ("ANO", lambda r: r.get("type_charge") == "ANO"),
              ("QA", lambda r: _side(r) == "qa"), ("Bogues / TNR", lambda r: not _side(r))]
    groups = [(lbl, [r for r in rs if f(r)]) for lbl, f in groups]
    groups = [(lbl, xs) for lbl, xs in groups if xs]
    if not groups:
        return _no_data(sl, x, y, w, h, title, "Aucune tâche")
    vals = [(name, [sum(1 for r in xs if _state(r) == name) or None for _, xs in groups]) for name, _ in STATES]
    vals = [(name, v) for name, v in vals if any(v)]
    colors = [dict(STATES)[name] for name, _ in vals]
    ch = _chart(sl, XL_CHART_TYPE.BAR_STACKED, x, y, w, h, [lbl for lbl, _ in groups], vals, title, colors, labels=True, fmt="0", gap=45)
    ch.category_axis.reverse_order = True
    ch.value_axis.visible = False
    ch.value_axis.has_major_gridlines = False


def _annex(prs, n, meta, ch, rs, st, today_iso):
    """Annexe du chantier : flux de tâches et état des tâches (à consulter au besoin, pas à présenter en daily)."""
    sl = _slide(prs, "31_Title Slide")
    _title(sl, f"Annexe – {ch} · tendances", f"Au {long_date(today_iso)} · évolution du périmètre et état des tâches")
    _flow(sl, st, 0.25, 1.05, 12.83, 2.85)
    _states(sl, rs, 0.25, 4.1, 12.83, 2.88)
    _page_no(sl, n)


def _messages(st: dict) -> list[str]:
    """Messages clés d'un chantier (4 au plus) : ce qui manque, ce qui dérape, ce qui bloque, ce qui a bougé depuis la veille."""
    out = []
    for sd in ("dev", "qa"):
        s = st[sd]
        if not s["n"] and s["raf"] < 0.005:
            continue
        if s["raf"] < 0.005:
            out.append(f"{SIDES[sd]} soldé")
        elif s["gap"] is not None and s["gap"] < -0.005:
            out.append(f"{SIDES[sd]} : il manque {jh(-s['gap'])} JH ({jh(s['raf'])} de RAF pour {jh(s['capa'])} de CAPA)")
        elif s["gap"] is not None:
            out.append(f"{SIDES[sd]} : couvert, marge de {jh(s['gap'])} JH")
        elif s["need"] is not None and s["need"] > s["left"] + 0.05:
            out.append(f"{SIDES[sd]} : au rythme actuel, {s['need']:.1f} j de travail pour {s['left']} j ouvrés".replace(".", ","))
    e_txt, e_lvl = _effort_short({k: st[k]["effort"] for k in ("dev", "qa")})
    if e_lvl == "red":
        out.append(f"Effort : forte dérive ({e_txt} face à l'estimé)")
    alerts = [x for x in (
        f"{plural(st['n_blocked'], 'tâche')} bloquée{'s' if st['n_blocked'] > 1 else ''}" if st["n_blocked"] else "",
        f"{plural(st['n_late'], 'tâche')} en retard" if st["n_late"] else "") if x]
    if alerts:
        out.append(" · ".join(alerts))
    elif st["added"]:
        out.append(f"+{st['added']} tâche{'s' if st['added'] > 1 else ''} depuis la veille")
    return out[:4] or ["Rien à signaler"]


def _overview(prs, n, meta, stats, today_iso):
    """Vue d'ensemble : une ligne par chantier, puis les messages clés de chacun."""
    sl = _slide(prs, "31_Title Slide")
    ms = " · ".join(f"fin {SIDES[sd]} {short_date(meta.get(MILESTONE[sd]))}" for sd in ("dev", "qa") if meta.get(MILESTONE[sd]))
    prev = next((s["prev_day"] for s in stats if s["prev_day"]), None)
    _title(sl, f"BUILD {meta['sprint']} – vue d'ensemble", f"Situation au {long_date(today_iso)}" + (f" · {ms}" if ms else ""))
    H = {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.CENTER}
    head = [("Chantier", {**H, "align": PP_ALIGN.LEFT})] + [(h, H) for h in (
        "Météo", "Avancement", "RAF DEV", "Écart DEV", "RAF QA", "Écart QA", "Dérive effort DEV / QA", "Bogues ouverts", "Retards · blocages")]
    rows = [head]
    C = {"align": PP_ALIGN.CENTER}
    for st in stats:
        fg, bg = LVL_STYLE[st["lvl"]]
        row = [(st["ch"], {"bold": True}), (st["word"], {**C, "bold": True, "color": fg, "fill": bg}),
               (pct(100 * st["done"] / st["n"]) if st["n"] else "—", C)]
        for sd in ("dev", "qa"):
            s = st[sd]
            d_txt = _delta(s["raf"] - s["raf_prev"])[0] if s["raf_prev"] is not None else None
            row += [(jh(s["raf"]) + (f"  ({d_txt})" if d_txt else ""), {**C, "bold": True}),
                    (signed(s["gap"]), {**C, "bold": True, "color": RED if s["gap"] is not None and s["gap"] < -0.005 else OK_TXT if s["gap"] is not None else MUTED})]
        e_txt, e_lvl = _effort_short({k: st[k]["effort"] for k in ("dev", "qa")})
        fg, bg = LVL_STYLE[e_lvl]
        row += [(e_txt, {**C, "bold": True, "color": fg, "fill": bg}), (str(st["bugs_open"]), C),
                (f"{st['n_late']} · {st['n_blocked']}", {**C, "bold": bool(st["n_late"] or st["n_blocked"]),
                                                        "color": RED if st["n_blocked"] else AMBER_TXT if st["n_late"] else INK})]
        rows.append(row)
    row_h = 0.42
    _table(sl, 0.15, 1.05, [2.55, 1.45, 1.15, 1.35, 1.0, 1.35, 1.0, 1.4, 0.85, 0.9], rows, row_h=row_h, size=11.5)
    legend = (f"Entre parenthèses : variation du RAF depuis le {short_date(prev)} · " if prev else "") + \
        "Écart = CAPA − RAF (négatif : capacité manquante) · Météo : RAF > CAPA hors capacité, ≥ 80 % ou retard sous tension · " \
        "Dérive effort = à terminaison (consommé + reste) face à l'estimé initial"
    _text(sl, 0.15, 1.1 + row_h * len(rows), 13, 0.28, [legend], size=9, color=MUTED)
    # messages clés : une carte par chantier, côte à côte (3 par ligne)
    top = 1.65 + row_h * len(rows)
    k = max(1, min(len(stats), 3))
    w = (12.9 - 0.2 * (k - 1)) / k
    for i, st in enumerate(stats):
        x, y = 0.15 + (i % k) * (w + 0.2), top + (i // k) * 1.75
        if y + 1.6 > 7.0:
            break
        fg, _ = LVL_STYLE[st["lvl"]]
        _text(sl, x, y, w, 1.6, [[(st["ch"], {"bold": True, "size": 12, "color": fg}), (f" · {st['word']}", {"size": 12, "color": fg})]]
              + [[("• " + m, {"size": 11})] for m in _messages(st)], fill=PANEL, margin=0.16)
        bar = sl.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(0.07), Inches(1.6))
        bar.fill.solid(); bar.fill.fore_color.rgb = fg
        bar.line.fill.background(); bar.shadow.inherit = False
    _page_no(sl, n)


def _weight(row: list) -> float:
    """Poids d'une ligne de tableau d'après la longueur du libellé (~85 caractères par ligne à 9 pt en Segoe UI) : 1, 1,4 ou 2."""
    n = len(str(row[0][0]))
    return 2.0 if n > 170 else 1.4 if n > 85 else 1.0


def _paginate(blocks: list[list], cont=None) -> list[list]:
    """Répartit des blocs de lignes en pages de ROWS_PER_SLIDE, sans couper un bloc quand c'est possible.
    cont(bloc) : première ligne d'un bloc coupé, répétée en tête de la page suivante (« (suite) »)."""
    pages, cur, cw = [], [], 0.0
    for block in blocks:
        bw = sum(map(_weight, block))
        if cur and cw + bw > ROWS_PER_SLIDE:
            # bloc long et page encore bien libre : il la remplit, la suite passe à la page suivante (pas de grand vide)
            if cont and ROWS_PER_SLIDE - cw >= 5 and len(block) > 4:
                k, acc = 0, cw
                while k < len(block) and acc + _weight(block[k]) <= ROWS_PER_SLIDE:
                    acc += _weight(block[k]); k += 1
                cur += block[:k]
                block = [cont(block)] + block[k:]
                bw = sum(map(_weight, block))
            pages.append(cur); cur, cw = [], 0.0
        while bw > ROWS_PER_SLIDE:
            k, acc = 0, 0.0
            while k < len(block) and acc + _weight(block[k]) <= ROWS_PER_SLIDE:
                acc += _weight(block[k]); k += 1
            pages.append(block[:k])
            block = ([cont(block)] if cont else []) + block[k:]
            bw = sum(map(_weight, block))
        cur += block; cw += bw
    if cur:
        pages.append(cur)
    return pages


def _detail(prs, n, meta, ch, rs):
    """Détail des tâches ouvertes : FEAT (bandeau vert) → US → tâches, à la suite sur des pages pleines (une FEAT ne force
    plus une nouvelle page). US et tâches terminées comptées, pas listées : leur détail est dans l'outil."""
    order = {"DEV": 0, "ANO": 1, "BUG": 2, "QA": 3}
    by_feat: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rs:
        if not _side(r):
            continue  # bogues hors DEV / QA : diapositive Bogues et TNR
        by_feat[r.get("feat") or "(Sans FEAT)"][r.get("us_key") or f"(sans US) {r.get('feat_src') or ''}"].append(r)
    head = [(h, {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.RIGHT if h.startswith("RAF") or h == "Échéance" else PP_ALIGN.LEFT})
            for h in ("FEAT · US · tâche", "Type", "État", "Personne", "Échéance", "RAF DEV", "RAF QA")]
    widths = [5.45, 1.0, 1.5, 1.95, 1.0, 1.05, 1.05]
    E = ("", {})
    blocks: list[list] = []
    for feat, uss in sorted(by_feat.items()):
        frs = [r for us in uss.values() for r in us]
        fill = {"fill": GREEN_LIGHT, "bold": True}
        f_eff = _effort_of(frs)
        f_txt, f_lvl = _effort_short(f_eff)
        feat_row = [(feat, fill), ("FEAT", fill), ("", fill),
                    (f"effort {f_txt}" if f_lvl != "unknown" else "", {**fill, "size": 8.5, "color": RED if f_lvl == "red" else AMBER_TXT if f_lvl == "amber" else INK}),
                    ("", fill),
                    (jh(sum(r.get("raf_dev") or 0 for r in frs), blank_zero=True), {**fill, "align": PP_ALIGN.RIGHT}),
                    (jh(sum(r.get("raf_qa") or 0 for r in frs), blank_zero=True), {**fill, "align": PP_ALIGN.RIGHT})]
        groups = sorted(uss.values(), key=lambda ts: max((t.get("due") or "") for t in ts))
        finished = [ts[0].get("us_key") or "sans US" for ts in groups if all(t.get("done") for t in ts)]
        feat_blocks = []
        for ts in groups:
            if all(t.get("done") for t in ts):
                continue  # US terminées : comptées en fin de FEAT
            u = ts[0]
            us_txt = f"{u.get('us_key') or ''} {u.get('us_summary') or ''}".strip() or "Sans US"
            P = {"fill": GREEN_PALE}
            done_quiet = [t for t in ts if t.get("done")]  # RAF resté sur une tâche finie : point d'attention « à solder »
            # US : son état, et le nombre de tâches finies à droite plutôt que sur une ligne à part
            block = [[(us_txt, {**P, "bold": True}), ("US", {**P, "bold": True}), (u.get("us_status") or "", {**P, "bold": True}),
                      (f"+ {plural(len(done_quiet), 'tâche finie', 'tâches finies')}" if done_quiet else "", {**P, "color": MUTED, "size": 8}),
                      ("", P), ("", P), ("", P)]]
            for t in sorted((t for t in ts if t not in done_quiet), key=lambda t: (t.get("done"), order.get(t.get("type_charge"), 9), t["key"])):
                bad = not t.get("done") and _has(t, "RETARD", "APRES_FREEZE", "APRES_FIN_TEST")
                due = t.get("due_dev") or t.get("due_qa") or t.get("due")
                block.append([(f"{t['key']}  {t.get('summary') or ''}", {"color": MUTED if t.get("done") else INK}),
                              (t.get("type_charge") or t.get("type") or "", {}),
                              (t.get("status") or "", {"fill": _state_fill(t)}),
                              (t.get("assignee") or "Non assignée", {"color": MUTED if not t.get("assignee") else INK}),
                              (short_date(due), {"align": PP_ALIGN.RIGHT, "bold": bad, "color": RED if bad else INK}),
                              (jh(t.get("raf_dev"), blank_zero=True), {"align": PP_ALIGN.RIGHT}),
                              (jh(t.get("raf_qa"), blank_zero=True), {"align": PP_ALIGN.RIGHT})])
            feat_blocks.append(block)
        if finished:
            feat_blocks.append([[(f"{plural(len(finished), 'US terminée', 'US terminées')} : {', '.join(finished)}", {"color": GREEN_DARK, "bold": True}),
                                 E, ("Fini", {"fill": GREEN_LIGHT, "bold": True}), E, E, E, E]])
        if not feat_blocks:
            continue
        feat_blocks[0] = [feat_row] + feat_blocks[0]  # la FEAT reste avec sa première US
        blocks += feat_blocks
    if not blocks:
        return n
    pages = _paginate(blocks, cont=lambda b: [(b[0][0][0] + " (suite)", b[0][0][1])] + b[0][1:])
    T = {"bold": True, "fill": GREEN_PALE}
    work = [r for r in rs if _side(r)]
    total = [("Total du chantier", T), ("", T), ("", T), ("", T), ("", T),
             (jh(sum(r.get("raf_dev") or 0 for r in work)), {**T, "align": PP_ALIGN.RIGHT}),
             (jh(sum(r.get("raf_qa") or 0 for r in work)), {**T, "align": PP_ALIGN.RIGHT})]
    for i, page in enumerate(pages, 1):
        sl = _slide(prs, "31_Title Slide")
        _title(sl, f"BUILD {meta['sprint']} – {ch} · tâches ouvertes" + (f" ({i}/{len(pages)})" if len(pages) > 1 else ""),
               "Par FEAT et par US ; tâches et US terminées comptées seulement (détail dans l'outil)")
        _table(sl, 0.15, 1.05, widths, [head] + page + ([total] if i == len(pages) else []), row_h=ROW_H, size=9)
        _page_no(sl, n); n += 1
    return n


def _bugs(prs, n, meta, ch, rs):
    all_bugs = [r for r in rs if not _side(r)]
    # bogues ouverts seulement : les clos ne demandent plus d'action (leur nombre est rappelé en sous-titre)
    bugs = sorted((r for r in all_bugs if not r.get("done")), key=lambda r: (r.get("due") or "9999", r["key"]))
    closed = len(all_bugs) - len(bugs)
    if not bugs:
        return n
    head = [(h, {"bold": True, "color": WHITE, "fill": GREEN_DARK, "align": PP_ALIGN.RIGHT if h in ("Échéance", "RAF (JH)", "Estimé (JH)") else PP_ALIGN.LEFT})
            for h in ("Bogue / TNR", "US liée", "État", "Personne", "Échéance", "RAF (JH)", "Estimé (JH)")]
    widths = [5.25, 1.65, 1.5, 1.8, 0.95, 0.9, 0.95]
    body = []
    for r in bugs:
        bad = not r.get("done") and _has(r, "RETARD")
        # US du sprint liées, avec le sens du lien quand ce n'est pas un simple « Lié à » (« Bloque EP… »)
        links = r.get("linked_us") or ([{"key": r["us_key"], "rel": ""}] if r.get("us_key") else [])
        us = ", ".join((f"{u['rel']} " if u.get("rel") and u["rel"] != "Lié à" else "") + u["key"] for u in links[:2]) + (" …" if len(links) > 2 else "")
        body.append([(f"{r['key']}  {r.get('summary') or ''}", {"color": MUTED if r.get("done") else INK}), (us, {"size": 8, "color": MUTED}),
                     (r.get("status") or "", {"fill": _state_fill(r)}),
                     (r.get("assignee") or "Non assignée", {}), (short_date(r.get("due")) or "sans", {"align": PP_ALIGN.RIGHT, "bold": bad, "color": RED if bad else MUTED if not r.get("due") else INK}),
                     (jh(0 if r.get("done") else r.get("raf_hj")), {"align": PP_ALIGN.RIGHT}), (jh(r.get("estim_hj")), {"align": PP_ALIGN.RIGHT})])
    total = [("Total", {"bold": True, "fill": GREEN_PALE}), ("", {"fill": GREEN_PALE}), ("", {"fill": GREEN_PALE}), ("", {"fill": GREEN_PALE}), ("", {"fill": GREEN_PALE}),
             (jh(sum(0 if r.get("done") else (r.get("raf_hj") or 0) for r in bugs)), {"bold": True, "align": PP_ALIGN.RIGHT, "fill": GREEN_PALE}),
             (jh(sum(r.get("estim_hj") or 0 for r in bugs)), {"bold": True, "align": PP_ALIGN.RIGHT, "fill": GREEN_PALE})]
    pages = _paginate([[row] for row in body])
    for i, page in enumerate(pages, 1):
        sl = _slide(prs, "31_Title Slide")
        _title(sl, f"BUILD {meta['sprint']} – {ch} · bogues et TNR ouverts" + (f" ({i}/{len(pages)})" if len(pages) > 1 else ""),
               "Hors RAF DEV / QA" + (f" · {plural(closed, 'bogue clos', 'bogues clos')} non affiché{'s' if closed > 1 else ''}" if closed else ""))
        _table(sl, 0.15, 1.05, widths, [head] + page + ([total] if i == len(pages) else []), row_h=ROW_H, size=9)
        _page_no(sl, n); n += 1
    return n


def build(meta: dict[str, Any], rows: list[dict], days: list[dict[str, Any]], today_iso: str,
          hist: list[tuple[str, list[dict]]] | None = None) -> bytes:
    """meta : _meta() de l'API ; rows : tâches du jour ; days : jours ouvrés de la semaine,
    {day, raf: {(chantier, côté): JH}, capa: {(chantier, côté): JH}} (sans « raf » pour un jour à venir) ;
    hist : relevés quotidiens du sprint [(jour, tâches)] jusqu'à la veille du rapport (tendances, variations)."""
    hist = [(d, x) for d, x in (hist or []) if d < today_iso] + [(today_iso, rows)]
    prs = Presentation(str(TEMPLATE))
    _fonts(prs)
    # couverture
    cov = _slide(prs, "Diapositive de titre heka", keep=(0, 1))
    cov.placeholders[0].text = "Daily New FEAT"
    d = _d(today_iso)
    sub = cov.placeholders[1].text_frame
    sub.text = f"Focus sur : état d'avancement des travaux sur le sprint {meta['sprint']}"
    sub.add_paragraph().text = f"Le {d:%d-%m-%Y}"
    if LOGO.exists():
        cov.shapes.add_picture(str(LOGO), Emu(10172418), Emu(265078), Emu(1900601), Emu(792476))
    n = 2
    chantiers = sorted({r["chantier"] for r in rows}, key=lambda c: (c.startswith("("), c.lower()))
    stats = {ch: _stats(meta, ch, [r for r in rows if r["chantier"] == ch], hist, days, today_iso) for ch in chantiers}
    if chantiers:
        _overview(prs, n, meta, list(stats.values()), today_iso); n += 1
    for ch in chantiers:
        rs = [r for r in rows if r["chantier"] == ch]
        _synthesis(prs, n, meta, ch, rs, days, today_iso, stats[ch]); n += 1
        n = _detail(prs, n, meta, ch, rs)
        n = _bugs(prs, n, meta, ch, rs)
    # annexes : graphiques de tendance, à consulter au besoin
    for ch in chantiers:
        _annex(prs, n, meta, ch, [r for r in rows if r["chantier"] == ch], stats[ch], today_iso); n += 1
    end = _slide(prs, "31_Title Slide", keep=(0,))
    end.placeholders[0].text = "Merci pour votre attention"
    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()
