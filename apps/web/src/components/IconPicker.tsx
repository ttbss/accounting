import { useState } from "react";

/** 依用途分組的常用圖示；不在清單裡的可以直接用鍵盤輸入任何 emoji */
const ICON_GROUPS: { name: string; icons: string[] }[] = [
  {
    name: "飲食",
    icons: [
      "🍱", "🍜", "🍝", "🍛", "🍣", "🍙", "🍚", "🥟", "🍲", "🥘", "🍳", "🥗", "🍔", "🍟", "🍕", "🌭",
      "🥪", "🌮", "🍗", "🍖", "🥩", "🍤", "🍢", "🍡", "🥞", "🧇", "🥐", "🍞", "🥯", "🥨", "🍰", "🎂",
      "🧁", "🍩", "🍪", "🍫", "🍬", "🍦", "🍧", "🍨", "🍮", "🍿", "🍎", "🍌", "🍉", "🍇", "🍓", "🥝",
      "🍍", "🥑", "🥦", "🥕", "🌽", "☕", "🍵", "🧋", "🥤", "🧃", "🥛", "🍺", "🍷", "🥂", "🍶",
    ],
  },
  {
    name: "交通",
    icons: [
      "🚌", "🚇", "🚆", "🚄", "🚊", "🚕", "🚗", "🛵", "🏍️", "🚲", "🛴", "⛽", "🅿️", "🚏", "✈️", "🛫",
      "🚢", "⛴️", "🚁", "🛣️", "🚦", "🔧", "🎫", "🗺️", "🧳",
    ],
  },
  {
    name: "購物",
    icons: [
      "🛍️", "🛒", "👕", "👖", "👗", "👔", "🧥", "👟", "👠", "👜", "🎒", "🕶️", "⌚", "💍", "💄", "🧴",
      "🧼", "🪥", "🧻", "📱", "💻", "🖥️", "🎧", "📷", "🔌", "🔋", "🎁", "📦", "🏷️",
    ],
  },
  {
    name: "居家",
    icons: [
      "🏠", "🏡", "🏢", "🛋️", "🛏️", "🚿", "🛁", "🧹", "🧺", "🧽", "🪴", "💡", "🔥", "💧", "⚡", "📶",
      "📺", "☎️", "🔑", "🪑", "🧰", "🔨", "🗑️", "🧊",
    ],
  },
  {
    name: "娛樂",
    icons: [
      "🎮", "🎬", "🎤", "🎵", "🎸", "🎹", "🎨", "📖", "🎳", "🎯", "🎲", "🧩", "🎢", "🎡", "🎟️", "🏖️",
      "🏕️", "⛺", "⛰️", "🏊", "🏄", "⚽", "🏀", "⚾", "🎾", "🏸", "⛳", "🏋️", "🧘", "🚴", "🎣", "♨️",
    ],
  },
  {
    name: "健康",
    icons: ["🏥", "💊", "💉", "🩺", "🦷", "👓", "🩹", "🌡️", "😷", "💆", "💇", "💅", "🧖", "🏃"],
  },
  {
    name: "家人寵物",
    icons: [
      "👶", "🍼", "🧸", "👪", "👵", "👴", "💑", "💒", "🐶", "🐱", "🐟", "🐦", "🐰", "🐹", "🦴", "🐾",
      "💐", "🌸",
    ],
  },
  {
    name: "學習工作",
    icons: ["📚", "✏️", "📝", "🎓", "🏫", "💼", "🖊️", "📎", "📐", "🖨️", "📊", "🗂️", "📮", "✉️"],
  },
  {
    name: "金錢",
    icons: ["💰", "💵", "💴", "💳", "🏦", "🪙", "💹", "📈", "📉", "🧾", "💸", "🏧", "🧧", "🤝", "📜", "🏆"],
  },
  {
    name: "其他",
    icons: [
      "📦", "🎉", "🎊", "🎈", "❤️", "⭐", "✨", "🔔", "📌", "🔖", "❓", "⚙️", "🛠️", "🙏", "👍", "😀",
      "😋", "🥳", "🌈", "☀️", "🌧️", "❄️", "🍀", "🌱", "🎄", "🎃", "🏮",
    ],
  },
];

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("zh-TW") : null;

function graphemes(value: string): string[] {
  if (segmenter) return Array.from(segmenter.segment(value), (x) => x.segment);
  return Array.from(value);
}

/**
 * 從輸入框的新內容找出「剛打的那個字」：完整的 emoji，包含 👨‍👩‍👧、國旗、膚色這種
 * 由好幾個字元組成的。框裡已經有舊圖示時，新打的不管在前面還是後面都抓得到。
 */
function typedIcon(next: string, prev: string): string {
  const all = graphemes(next.trim());
  const added = [...all];
  for (const g of graphemes(prev)) {
    const i = added.indexOf(g);
    if (i >= 0) added.splice(i, 1);
  }
  return added.at(-1) ?? all.at(-1) ?? "";
}

/** 和伺服器的限制一致（icon 最多 16 個 UTF-16 字元） */
const MAX_ICON_LENGTH = 16;

export function IconPicker({
  value,
  onChange,
  fallback,
}: {
  value: string;
  onChange: (icon: string) => void;
  /** 子分類：沒選的話用上層分類的圖示 */
  fallback?: string;
}) {
  // 先打開目前圖示所在的那一組
  const [group, setGroup] = useState(() => Math.max(0, ICON_GROUPS.findIndex((g) => g.icons.includes(value))));

  return (
    <div className="field">
      <span className="label">圖示{fallback !== undefined && "（可不選，會用上層分類的圖示）"}</span>
      <div className="icon-input-row">
        <input
          className="input icon-input"
          value={value}
          placeholder={fallback || "?"}
          aria-label="圖示，可以直接輸入任何 emoji"
          // 點進去就全選，直接打新的就會取代舊的
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const g = typedIcon(e.target.value, value);
            if (g.length <= MAX_ICON_LENGTH) onChange(g);
          }}
        />
        <span className="muted icon-input-hint">從下面選，或點左邊的框用鍵盤輸入任何 emoji</span>
        {fallback !== undefined && value && (
          <button type="button" className="link-btn" onClick={() => onChange("")}>
            不使用
          </button>
        )}
      </div>

      <div className="icon-groups" role="tablist">
        {ICON_GROUPS.map((g, i) => (
          <button key={g.name} type="button" role="tab" aria-selected={i === group} onClick={() => setGroup(i)}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="emoji-row" role="tabpanel" aria-label={ICON_GROUPS[group]!.name}>
        {ICON_GROUPS[group]!.icons.map((em) => (
          <button key={em} type="button" aria-pressed={em === value} aria-label={`使用 ${em}`} onClick={() => onChange(em)}>
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}
