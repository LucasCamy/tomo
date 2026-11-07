# ADR-0001: Sincronizacao automatica de backup local e verificacao sob demanda de versoes via GitHub

- Status: Aceita
- Data do registro: 2026-11-06
- Referencias: [README.md](../../README.md), [AGENTS.md](../../AGENTS.md)

## Contexto

O Tomo armazena todas as abas, links, notas e miniaturas no `IndexedDB` local da extensao (`tomo_shelf_db`). Com a distribuicao fora da Chrome Web Store por meio de pacotes `.zip` em GitHub Releases (carregados em modo desenvolvedor), surgiram duas necessidades operacionais na Estante (`dashboard.html`):

1. Manter um arquivo `.json` fixo atualizado no computador (por exemplo em `Documentos` ou em uma pasta sincronizada pelo OneDrive/Google Drive) sem acumular dezenas de downloads repetidos na pasta `Downloads`.
2. Verificar se ha uma nova versao publicada no GitHub e recarregar a extensao em 1 clique apos extrair os arquivos atualizados, sem abrir manualmente `chrome://extensions/`.

Restricoes tecnicas e de seguranca do Chromium que condicionam a solucao:

- Extensoes instaladas sem compactacao (*unpacked*) nao possuem auto-update silencioso fora da Chrome Web Store (exceto por politicas corporativas de registro).
- A File System Access API (`FileSystemWritableFileStream`) bloqueia a escrita direta de extensoes executaveis ou scripts (`.js`, `.bat`, `.ps1`), impedindo que a propria extensao sobrescreva seu `background.js` ou bundles em disco; alem disso, incluir scripts `.bat`/`.ps1` no pacote `.zip` aciona alertas do Google Safe Browsing no download.
- Nenhum link salvo, nota ou dado de navegacao do usuario pode sair da maquina.

## Decisao

Adotar uma arquitetura em duas frentes acionada a partir do modal **Sincronizacao e Atualizacao** na Estante:

1. **Sincronizacao automatica em arquivo `.json` local (`src/lib/fileSync.ts`):**
   - Utilizar `window.showSaveFilePicker` para que o usuario escolha uma unica vez um arquivo `.json` fixo no computador e persistir o `FileSystemFileHandle` estruturado na store `meta` do `IndexedDB` (`tomo_shelf_db`, chave `backup_file_sync`), sem alterar `DB_VERSION`.
   - Serializar todas as gravacoes em fila em memoria (`enqueueSerializedWrite`) para evitar colisoes de arquivo temporario (`.crswap`) e perda de atualizacoes concorrentes.
   - Enquanto a permissao `readwrite` estiver `'granted'` na sessao, gravar automaticamente no arquivo vinculado (com debounce de `450ms`) apenas quando a assinatura de estado da estante mudar apos a hidratacao inicial, evitando sobrescrita acidental ao apenas abrir o painel.
   - Apos reinicio do navegador, quando o Chromium redefine a permissao do handle para `'prompt'`, exibir estado visual de reativacao pendente e solicitar `handle.requestPermission({ mode: 'readwrite' })` mediante 1 clique explicito do usuario, alem de permitir mesclar dados vindos desse mesmo arquivo (`pullFromLinkedBackupFile`).

2. **Verificacao sob demanda no GitHub Releases e recarregamento assistido (`src/lib/updater.ts` e `src/background.ts`):**
   - Consultar `GET https://api.github.com/repos/LucasCamy/tomo/releases/latest` exclusivamente por acao explicita do usuario no botao **Verificar nova versao**, com `credentials: 'omit'` e `cache: 'no-store'`, sem transmitir qualquer dado da estante.
   - Comparar `SemVer` entre `chrome.runtime.getManifest().version` e `tag_name`, sanitizando estritamente `html_url` e `browser_download_url` para aceitar apenas URLs `https://github.com/LucasCamy/tomo/...`.
   - Oferecer o botao **Aplicar e recarregar extensao**, que registra um marcador temporario (`tomo_reopen_dashboard_ts`, janela de 30s) em `chrome.storage.local` e chama `chrome.runtime.reload()`, fazendo o Service Worker (`src/background.ts`) reabrir ou focar automaticamente `dashboard.html` ja na nova versao.

## Alternativas consideradas

1. **Auto-atualizacao silenciosa sobrescrevendo a pasta da extensao via `showDirectoryPicker` ou script `.ps1`/`.bat` embutido no `.zip`:**
   - Rejeitada porque o Chromium bloqueia escrita de arquivos `.js` via File System Access API por seguranca e sinaliza arquivos `.zip` contendo `.bat`/`.ps1` como potencialmente perigosos no download.
2. **Servidor intermediario ou sincronizacao em nuvem propria:**
   - Rejeitada por violar a premissa de operacao local sem conta e sem envio de links ou historico do usuario para terceiros.
3. **Verificacao automatica de versao em segundo plano a cada abertura da Estante:**
   - Rejeitada para preservar zero trafego externo nao solicitado; a verificacao permanece 100% opt-in por clique.

## Consequencias

- **Positivas:**
  - O usuario mantem um unico `tomo-backup.json` sempre atualizado durante a sessao (inclusive compativel com pastas locais de OneDrive/Google Drive para sincronizar entre computadores via **Ler do arquivo (Mesclar)**).
  - A verificacao de nova versao, o download do `.zip` oficial e o recarregamento da extensao com reabertura automatica da Estante ocorrem diretamente pela interface do Tomo.
  - Nenhum esquema do `IndexedDB` precisou de migracao destrutiva (`DB_VERSION = 1` preservado).
- **Custos e limitacoes:**
  - Por imposicao do modelo de seguranca do Chromium, apos fechar e reabrir o navegador o usuario precisa confirmar 1 clique em **Gravar agora** (ou **Reativar backup automatico**) para restaurar a permissao `readwrite` da sessao sobre o arquivo local.
  - Na atualizacao da extensao fora da Chrome Web Store, a etapa de extrair o `.zip` sobre a pasta instalada continua manual no sistema operacional antes de clicar em **Aplicar e recarregar extensao**.

## Implementacao e verificacao

- Implementado em `src/lib/db.ts`, `src/lib/fileSync.ts`, `src/lib/updater.ts`, `src/background.ts`, `src/dashboard/DashboardApp.tsx` e `src/styles/app.css`.
- Coberto por testes unitarios em `src/lib/__tests__/shelf.test.ts` (comparacao `SemVer`, sanitizacao de dominio/caminho do GitHub e rejeicao de URLs externas) e validado em navegador real via Chrome DevTools MCP (persistencia de `FileSystemFileHandle`, escrita automatica apos incremento de capitulo, temas escuro/claro e layout mobile `375x812`).
