// Verifica matematicamente o contraste WCAG 2.1 AA (>= 4.5:1) de todos os tokens de texto sobre todas as superficies.

const themes = {
  dark: {
    surfaces: {
      bg: '#0C0E12',
      surface: '#13171E',
      subtle: '#1A2029',
      selected: '#222936',
    },
    texts: {
      ink: '#F3F0EA',
      muted: '#A4AEBD',
      action: '#F59B4C',
      success: '#5ED396',
      warning: '#F5BC4C',
      destructive: '#FA7D7D',
    },
    actionPair: {
      bg: '#F59B4C',
      fg: '#170E06',
    },
  },
  light: {
    surfaces: {
      bg: '#F6F3EC',
      surface: '#FFFFFF',
      subtle: '#ECE7DD',
      selected: '#E2DBD0',
    },
    texts: {
      ink: '#181B20',
      muted: '#525A66',
      action: '#9E3814',
      success: '#16653E',
      warning: '#7D4D08',
      destructive: '#A62626',
    },
    actionPair: {
      bg: '#9E3814',
      fg: '#FFFFFF',
    },
  },
};

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(hexA, hexB) {
  const l1 = luminance(hexToRgb(hexA));
  const l2 = luminance(hexToRgb(hexB));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

let failed = false;

for (const [themeName, theme] of Object.entries(themes)) {
  console.log(`\n=== Tema: ${themeName.toUpperCase()} ===`);
  const surfaceKeys = Object.keys(theme.surfaces);
  console.log(
    `| Token | Hex | ${surfaceKeys.map((k) => `${k} (${theme.surfaces[k]})`).join(' | ')} |`
  );
  console.log(`|---|---|${surfaceKeys.map(() => '---').join('|')}|`);

  for (const [textName, textHex] of Object.entries(theme.texts)) {
    const ratios = surfaceKeys.map((surfKey) => {
      const ratio = contrastRatio(textHex, theme.surfaces[surfKey]);
      if (ratio < 4.5) {
        failed = true;
      }
      return `${ratio.toFixed(2)}:1`;
    });
    console.log(`| \`${textName}\` | \`${textHex}\` | ${ratios.join(' | ')} |`);
  }

  const btnRatio = contrastRatio(theme.actionPair.fg, theme.actionPair.bg);
  if (btnRatio < 4.5) failed = true;
  console.log(
    `Par on-action (${theme.actionPair.fg}) sobre action (${theme.actionPair.bg}): ${btnRatio.toFixed(2)}:1`
  );
}

if (failed) {
  console.error('\nERRO: Algum par de cor ficou abaixo de 4.5:1 (WCAG AA).');
  process.exit(1);
} else {
  console.log('\nOK: Todos os pares aprovados em WCAG AA (>= 4.5:1).');
}
