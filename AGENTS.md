# AGENTS.md

## Proposito e stack

**Tomo** e uma extensao para Google Chrome (Manifest V3) voltada a salvar sites, leituras e mangas separados por abas/colecoes visuais, com captura automatica de capa (`og:image` ou miniatura da aba), controle rapido de capitulo/progresso e armazenamento 100% local na maquina (`IndexedDB`), incluindo exportacao e importacao em arquivo `.json`.

- **Runtime e UI:** React 19 + TypeScript + Vite (build multi-pagina gerando `dist/popup.html` e `dist/dashboard.html`).
- **Estilizacao e icones:** CSS semantico orientado por tokens (`src/styles/tokens.css`), fontes locais `@fontsource-variable` e icones geometricos `lucide-react`.
- **Persistencia:** `IndexedDB` local (`tomo_shelf_db`) sincronizado entre abas/popup via `BroadcastChannel`, mais preferencias visuais em `localStorage` / `chrome.storage.local`.

## Organizacao

- `public/manifest.json` e `public/icons/`: configuracao Manifest V3 (`commands` de teclado, `service_worker`) e icones PNG da extensao.
- `src/background.ts`: Service Worker Manifest V3 para atalhos globais (`Alt+Shift+S` salvar/atualizar em 1 tecla, `Alt+Shift+X` salvar e fechar aba, `Alt+Shift+O` abrir estante) com compressao `OffscreenCanvas` e aviso em Shadow DOM.
- `popup.html` e `src/popup/`: popup rapido da barra do Chrome para salvar/atualizar a aba ativa em 1 clique ou via teclado (`Enter`, `Alt+Enter`, `Alt+Seta`, `Alt+1..9`).
- `dashboard.html` e `src/dashboard/`: painel visual completo (estante em tela cheia) com gestao de abas, cards, busca, atalhos rapidos (`/`, `N`, `G`, `0..9`, `?`), importacao em lote de abas abertas, backup JSON automatico em arquivo fixo e verificacao de versao.
- `src/components/`: componentes reutilizaveis de cartao (`LinkCard.tsx`), dropdown acessivel customizado (`SelectDropdown.tsx`), modal (`ModalDialog.tsx`), capas e emblemas de estado (`ShelfIcons.tsx`).
- `src/lib/`: banco `IndexedDB` (`db.ts`), auditoria de saude e sincronizacao sequencial (`shelfSync.ts`), vinculo/gravacao automatica em arquivo local via File System Access API (`fileSync.ts`), consulta opt-in de versao no GitHub Releases e reload da extensao (`updater.ts`), deteccao/incremento de capitulo e extracao de series (`progress.ts`), atalhos (`shortcuts.ts`), ponte segura com APIs do Chrome (`chromeBridge.ts`) e tema (`theme.ts`).
- `src/styles/`: `tokens.css` (unica fonte de cores e tokens) e `app.css` (layout, responsividade e microinteracoes).
- `scripts/`: `verify-contrast.mjs` (calculo WCAG AA), `generate-icons.mjs` (geracao deterministica dos icones PNG) e `pack-release.mjs` (empacotamento `.zip` da extensao para GitHub Releases / Chrome Web Store).

## Comandos

- `npm run verify:contrast`: verifica contraste WCAG AA (>= 4,5:1) dos tokens claro/escuro (**executado e aprovado**).
- `npm run generate:icons`: gera os icones PNG em `public/icons/` (**executado**).
- `npm run dev`: servidor Vite local para desenvolvimento (**encontrado em `package.json`**).
- `npm run build`: checagem TypeScript (`tsc -b`) + build de producao em `dist/` para carregar no Chrome (**executado e aprovado**).
- `npm run pack`: executa o build de producao e gera `release/tomo-chrome-v*.zip` pronto para distribuicao (**executado e aprovado**).
- `npm test`: testes unitarios com Vitest (**executado e aprovado: 20/20 testes**).

## Convencoes e validacao de UI

- Preservar `DESIGN.md` e `src/styles/tokens.css`: nao usar hex solto nos componentes, nao usar emojis como icones e nao usar travessao longo em textos de interface.
- Estados semanticos exigem sempre icone distinto + texto + cor.
- Em mudancas de UI: quando Figma MCP estiver configurado e solicitado, estruturar frames antes do codigo; neste ambiente sem Figma MCP configurado, mudancas diretas seguem autorizacao do usuario e validacao real em navegador (larguras desktop/mobile, temas escuro/claro, foco/teclado, `prefers-reduced-motion` e console limpo).

## Seguranca e operacao local

- Nenhum dado de navegacao ou link salvo pode ser enviado para servidores externos; toda persistencia e exportacao/importacao ocorre localmente na maquina do usuario. A unica requisicao externa permitida e a consulta publica opcional (`credentials: 'omit'`) de versao em `api.github.com/repos/LucasCamy/tomo/releases/latest` acionada explicitamente pelo usuario (ver `docs/adr/0001-sincronizacao-local-e-verificacao-de-atualizacao.md`).
- Na importacao de `.json`, validar schema e formato das URLs (`http:` / `https:`) antes de gravar no `IndexedDB`, bloqueando esquemas executaveis (`javascript:`, `data:` arbitrario em links).

## Documentacao e decisoes

Mantenha a documentacao alinhada ao comportamento implementado e identifique propostas como propostas. Atualize `README.md` para execucao e carregamento da extensao no Chrome e `DESIGN.md` quando tokens ou regras visuais mudarem.

Consulte decisoes anteriores antes de alterar arquitetura, dados ou seguranca. Registre novas decisoes duraveis em ADRs em `docs/adr/NNNN-titulo-curto.md` (contexto, decisao, alternativas e consequencias) apenas quando houver mudanca arquitetural relevante; nao crie ADR para alteracoes triviais.
