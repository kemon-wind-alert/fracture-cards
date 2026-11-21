"""骨折アシスト（fx_app）のデータから暗記カード用の data/cards.json を作る。

使い方:  python fc_app/build_cards.py
  - 元データ: ../fx_app/data/fractures.json（骨ごと→病型ごと）
  - 追加病型: extra/*.json（{"bone_id": "ankle", "subtype": {...病型...}}）。
    fx_app に無い病型をカード側だけ先に足すときに使う
  - 骨折データを直したら、このスクリプトを再実行するだけでカードに反映される
"""
from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent / "fx_app" / "data" / "fractures.json"
EXTRA_DIR = HERE / "extra"
# 骨折以外（脱臼・腱損傷・靱帯損傷・筋損傷）。fractures.json と同じ「疾患→病型」の形で、"category" キー付き
CONDITIONS_DIR = HERE / "conditions"
OUT = HERE / "data" / "cards.json"

# 新しいカードを出す順番＝外来で出会う頻度の見立て（医学的内容ではなく並べ方だけ）。
# よく出会う骨折から覚えられるように。同じ骨の病型どうしは隣に並べて違いを比べやすくする
BONE_PRIORITY = [
    "distal_radius", "ankle", "fifth_metatarsal", "vertebral_compression", "metacarpal",
    "phalanx_hand", "bony_mallet", "metatarsal", "toe", "rib", "clavicle", "proximal_humerus",
    "radial_head", "scaphoid", "olecranon", "proximal_femur", "pelvic_fragility", "patella",
    "calcaneus", "tibial_plateau",
]
GROUP_NAME = {"upper": "上肢", "lower": "下肢", "trunk": "体幹"}
# 固定期間の文に含まれていたら印を付ける語
#   unverified（未確認）: 一次情報で数値を確かめられていない／期間の記載なし
#   rough（目安）: 出典はあるが幅のある目安として書かれている
UNVERIFIED_WORDS = ("未確認", "根拠は", "明確な根拠")
ROUGH_WORDS = ("目安", "程度", "前後")


def _card(bone: dict, s: dict, extra: bool = False) -> dict:
    """1病型＝カード1枚。bone は骨折なら骨、骨折以外なら疾患のオブジェクト"""
    cons = s.get("conservative") or {}
    surg = s.get("surgical") or {}
    duration = (cons.get("duration") or "").strip()
    if not duration and surg and not extra:
        weak = ""  # 手術が基本の病型（保存の期間は書かれていない）
    elif extra or not duration or any(w in duration for w in UNVERIFIED_WORDS):
        weak = "unverified"
    elif any(w in duration for w in ROUGH_WORDS):
        weak = "rough"
    else:
        weak = ""
    return {
        "id": f"{bone['id']}.{s['id']}",
        "bone": bone["name"],
        "bone_id": bone["id"],
        "cat": bone.get("category", "骨折"),
        "group": GROUP_NAME.get(bone.get("group", ""), "その他"),
        "name": s["name"],
        "criteria": s.get("criteria", ""),
        "urgency": s.get("urgency", ""),
        "standard": s.get("standard", ""),
        "cons": {k: cons.get(k, "") for k in ("indication", "method", "range_position", "duration", "notes")} if cons else None,
        "surg": {"indication": surg.get("indication", []), "options": surg.get("options", []),
                 "timing": surg.get("timing", "")} if surg else None,
        "bg": s.get("by_background", []),
        "followup": s.get("followup", []),
        "pitfalls": s.get("pitfalls", []),
        "weak": weak,
        "confidence": s.get("confidence") or bone.get("confidence", ""),
        "new": extra,
        # 盲検の独立査読を通ったか（疾患の review_note か、追加病型自身の review_note に記録がある）
        "reviewed": bool(re.search(r"【盲検査読\s?20\d\d-", bone.get("review_note", "") + s.get("review_note", ""))),
    }


def main() -> None:
    bones = json.loads(SRC.read_text(encoding="utf-8"))
    by_id = {b["id"]: b for b in bones}
    cards = [_card(b, s) for b in bones for s in b["subtypes"]]

    if EXTRA_DIR.exists():
        for p in sorted(EXTRA_DIR.glob("*.json")):
            e = json.loads(p.read_text(encoding="utf-8"))
            bone = by_id[e["bone_id"]]
            card = _card(bone, e["subtype"], extra=True)
            # 同じ骨の最後の病型の直後に差し込む（早見表で骨ごとにまとまるように）
            last = max(i for i, c in enumerate(cards) if c["bone_id"] == bone["id"])
            cards.insert(last + 1, card)

    if CONDITIONS_DIR.exists():
        for p in sorted(CONDITIONS_DIR.glob("*.json")):
            for cond in json.loads(p.read_text(encoding="utf-8")):
                cards += [_card(cond, s) for s in cond["subtypes"]]

    rank = {b: i for i, b in enumerate(BONE_PRIORITY)}
    cards.sort(key=lambda c: rank.get(c["bone_id"], len(rank)))  # 安定ソートなので骨の中の順は保たれる

    ids = [c["id"] for c in cards]
    assert len(ids) == len(set(ids)), "カードIDが重複しています"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    nu = sum(c["weak"] == "unverified" for c in cards)
    nr = sum(c["weak"] == "rough" for c in cards)
    print(f"{len(cards)}枚を書き出しました（未確認 {nu}枚・目安 {nr}枚） → {OUT}")


if __name__ == "__main__":
    main()
