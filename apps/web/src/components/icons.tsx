import type { JSX, ReactNode } from "react";
import type { AccountType } from "@accounting/shared";

/** 介面用的線條圖示（24×24，顏色跟著文字顏色走）；分類圖示仍用 emoji */
function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconList = () => (
  <Svg>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9.5 8h5M9.5 12h5M9.5 16h2.5" />
  </Svg>
);

export const IconChart = () => (
  <Svg>
    <path d="M5 20v-6M12 20V5M19 20v-10" />
  </Svg>
);

export const IconWallet = () => (
  <Svg>
    <rect x="3" y="6" width="18" height="14" rx="3" />
    <path d="M3 10h18M16 15h2" />
  </Svg>
);

export const IconSliders = () => (
  <Svg>
    <path d="M4 7h9M18 7h2M4 17h3M12 17h8" />
    <circle cx="15.5" cy="7" r="2.3" />
    <circle cx="9.5" cy="17" r="2.3" />
  </Svg>
);

export const IconPlus = () => (
  <Svg size={26}>
    <path d="M12 5v14M5 12h14" strokeWidth={2.4} />
  </Svg>
);

export const IconSync = () => (
  <Svg size={20}>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
  </Svg>
);

export const IconCloud = () => (
  <Svg size={20}>
    <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.1 9.5 4.3 4.3 0 0 0 7 18z" />
  </Svg>
);

export const IconDownload = () => (
  <Svg size={20}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
  </Svg>
);

export const IconTag = () => (
  <Svg size={20}>
    <path d="M3 12V4h8l9 9-8 8z" />
    <circle cx="7.5" cy="8.5" r="1.3" />
  </Svg>
);

export const IconStore = () => (
  <Svg size={20}>
    <path d="M4 9.5 5.5 4h13L20 9.5M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8M10 20v-5h4v5" />
  </Svg>
);

export const IconUser = () => (
  <Svg size={20}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

export const IconBank = () => (
  <Svg size={20}>
    <path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
  </Svg>
);

const IconCash = () => (
  <Svg size={20}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v5M18 9.5v5" />
  </Svg>
);

const IconCard = () => (
  <Svg size={20}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 10h19M6.5 15h4" />
  </Svg>
);

const IconPhone = () => (
  <Svg size={20}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Svg>
);

const IconCoins = () => (
  <Svg size={20}>
    <ellipse cx="12" cy="7" rx="7" ry="3" />
    <path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </Svg>
);

const ACCOUNT_ICONS: Record<AccountType, () => JSX.Element> = {
  cash: IconCash,
  bank: IconBank,
  credit_card: IconCard,
  e_wallet: IconPhone,
  other: IconCoins,
};

/** 帳戶類型的小圓章 */
export function AccountBadge({ type }: { type: AccountType }) {
  const Icon = ACCOUNT_ICONS[type] ?? IconCoins;
  return (
    <span className={`row-badge acct-${type}`} aria-hidden>
      <Icon />
    </span>
  );
}
