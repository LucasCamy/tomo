# DESIGN.md · Tomo (Estante Visual de Links)

## 1. Direcao Criativa ("Creative North Star")

**Metafora funcional:** *Estante viva de leitura e referencia*.
Em vez de uma lista cinza de favoritos ou dezenas de abas abertas consumindo memoria, o Tomo organiza cada site ou serie como um volume com capa, marcador de parada (`Cap. 142`, `Ep. 08`) e acao imediata para retomar a leitura ou atualizar onde parou.

### Principios de Interface
1. **A proxima acao vem antes do historico:** no Popup, salvar ou atualizar o capitulo atual da aba aberta ocupa o topo imediato; no Painel, retomar o link ou atualizar a parada tem hierarquia primaria sobre metadados secundarios.
2. **Um unico acento de acao (`--action`):** fita de marcador ambar-terracota no tema escuro (`#F59B4C`) e terracota profundo no tema claro (`#9E3814`). Verde, ocre e carmesim sao exclusivos de estado semantico.
3. **Estado = Forma + Texto + Cor:**
   - **Lendo (`reading`):** icone `BookOpen` + rotulo `"Lendo"` + token `--action`.
   - **Em dia (`up_to_date`):** icone `CircleCheck` + rotulo `"Em dia"` + token `--success`.
   - **Pausado (`paused`):** icone `CircleDashed` + rotulo `"Pausado"` + token `--warning`.
   - **Concluido (`completed`):** icone `CheckSquare` + rotulo `"Concluido"` + token `--muted`.
4. **Zero ruido decorativo:** sem gradientes roxo-azul, sem blobs, sem emojis como icones e sem travessao longo em textos visiveis.

---

## 2. Sistema de Tokens (`src/styles/tokens.css`) e Contraste WCAG AA

Todos os valores de cor vivem exclusivamente em `src/styles/tokens.css`. Nenhum componente usa hex solto.
Verificado por execucao via `node scripts/verify-contrast.mjs` (todos os pares >= 4,5:1).

### Tema Escuro (Padrao · `data-theme="dark"`)

| Token | Hex | `bg` (`#0C0E12`) | `surface` (`#13171E`) | `subtle` (`#1A2029`) | `selected` (`#222936`) |
|---|---|---|---|---|---|
| `ink` | `#F3F0EA` | 16,98:1 | 15,79:1 | 14,40:1 | 12,84:1 |
| `muted` | `#A4AEBD` | 8,62:1 | 8,01:1 | 7,30:1 | 6,51:1 |
| `action` | `#F59B4C` | 8,90:1 | 8,28:1 | 7,54:1 | 6,73:1 |
| `success` | `#5ED396` | 10,33:1 | 9,61:1 | 8,76:1 | 7,81:1 |
| `warning` | `#F5BC4C` | 11,20:1 | 10,42:1 | 9,50:1 | 8,47:1 |
| `destructive` | `#FA7D7D` | 7,63:1 | 7,10:1 | 6,47:1 | 5,77:1 |

- **Botao primario (`on-action` `#170E06` sobre `action` `#F59B4C`):** `8,78:1` (AAA).
- **Elevacao no escuro:** borda sutil `--line` (`rgba(243, 240, 234, 0.11)`) de `1px`, sem sombra preta pesada.

### Tema Claro (`data-theme="light"`)

| Token | Hex | `bg` (`#F6F3EC`) | `surface` (`#FFFFFF`) | `subtle` (`#ECE7DD`) | `selected` (`#E2DBD0`) |
|---|---|---|---|---|---|
| `ink` | `#181B20` | 15,58:1 | 17,26:1 | 14,01:1 | 12,56:1 |
| `muted` | `#525A66` | 6,29:1 | 6,97:1 | 5,66:1 | 5,07:1 |
| `action` | `#9E3814` | 6,25:1 | 6,93:1 | 5,62:1 | 5,04:1 |
| `success` | `#16653E` | 6,39:1 | 7,08:1 | 5,75:1 | 5,15:1 |
| `warning` | `#7D4D08` | 6,45:1 | 7,15:1 | 5,80:1 | 5,20:1 |
| `destructive` | `#A62626` | 6,48:1 | 7,18:1 | 5,82:1 | 5,22:1 |

- **Botao primario (`on-action` `#FFFFFF` sobre `action` `#9E3814`):** `6,93:1` (AA).
- **Elevacao no claro:** borda `--line` (`rgba(24, 27, 32, 0.11)`) + sombra tingida sutil.

---

## 3. Tipografia Tripla e Dados (`font-data`)

Fontes empacotadas localmente via `@fontsource-variable` (100% offline e compativel com CSP do Manifest V3):
1. **Display (`--font-display`):** `Bricolage Grotesque Variable` para titulos de colecao, cabecalhos e capa tipografica.
2. **Interface (`--font-sans`):** `Plus Jakarta Sans Variable` (`14px` a `16px`) para leitura confortavel de titulos de obras, rotulos e notas.
3. **Dados (`--font-data`):** `JetBrains Mono Variable` com `font-variant-numeric: tabular-nums` obrigatorio em marcadores de capitulo (`Cap. 142`), contadores (`12 links`), datas e resumos de backup (`4 abas · 18 links`).

---

## 4. Ergonomia, Responsividade e Motion

- **Recomposicao responsiva:**
  - Popup da extensao: `380px` de largura, focado em acao rapida de 1 clique.
  - Painel em tela cheia (`dashboard.html`): sidebar fixa (`256px`) a partir de `1024px`; em telas estreitas (`< 1024px`), cabecalho compacto com trilho horizontal de abas e barra inferior fixa (`Bottom Nav`) para acoes primarias.
- **Formularios acessiveis:** `label` visivel acima do campo, fonte `>= 16px` em telas `< 640px`, alvos interativos `>= 44px` no painel, validacao inline com `role="alert"` e `aria-invalid`.
- **Motion e Anti-Flick:**
  - Abas e filtros trocam o estado ativo instantaneamente (sem transicao de cor de fundo ao selecionar).
  - Clique tatil em botoes com `scale(0.97)` em `120ms`.
  - Modais entram em `240ms` (`--ease-out`) e saem em `160ms` (`--ease-in-out`), restaurando foco ao fechar com `Esc`.
  - Suporte integral a `prefers-reduced-motion: reduce`.
