# Tomo · Estante Visual de Links (Extensao Chrome)

Extensao local para Google Chrome (Manifest V3) para salvar e organizar sites, mangas, leituras e referencias separados por abas visuais, eliminando a necessidade de manter dezenas de abas abertas.

Tudo fica salvo **100% na sua maquina** (`IndexedDB` + `unlimitedStorage`), com suporte completo a **Exportar** e **Importar** backup em `.json`.

## Principais Recursos

- **Popup rapido ao clicar no icone:**
  - Captura automatica da capa da pagina (`og:image` ou miniatura visual da aba em WebP offline).
  - Deteccao automatica do capitulo/episodio atual (ex.: `Cap. 142`, `Cap. 375.5`, `Ep. 8`).
  - **Reconhecimento inteligente de obra ja salva:** se voce ja salvou um manga no `Cap. 142` e abrir o popup lendo o `Cap. 148`, basta 1 clique em **Atualizar parada** (ou **Atualizar e fechar**) sem duplicar favoritos.
  - Botao **Salvar e fechar** para guardar o link e liberar memoria do Chrome na hora.
- **Atalhos Rapidos de Teclado (Globais e Internos):**
  - `Alt+Shift+S`: salva o site atual (ou atualiza o capitulo se a obra ja estiver na estante) direto pelo teclado, sem precisar abrir o popup, exibindo aviso visual discreto no canto da pagina.
  - `Alt+Shift+X`: salva/atualiza o site atual e fecha a aba em seguida.
  - `Alt+Shift+Q`: abre o Popup rapido do Tomo (onde `Enter` / `Ctrl+Enter` salva, `Alt+Enter` salva e fecha, `Alt+Seta Cima/Baixo` altera o capitulo e `Alt+1..9` escolhe a aba).
  - `Alt+Shift+O`: abre ou foca a Estante completa (onde `/` foca a busca, `N` cria novo link, `G` guarda abas abertas, `0..9` troca de aba e `?` abre o guia de atalhos).
  - Personalizaveis em `chrome://extensions/shortcuts`.
- **Painel Visual em Tela Cheia (Estante):**
  - Separacao livre por abas/colecoes personalizaveis (`Mangas`, `Leituras & Estudos`, `Para ver depois`, ou quantas quiser criar, renomear, reordenar e escolher icone).
  - Botao `+1` direto no card para avancar o capitulo rapidamente e botao **Atualizar parada** conectado as abas abertas do navegador.
  - **Guardar abas abertas em lote:** selecione varias abas abertas da janela do Chrome, salve todas de uma vez na colecao escolhida e feche-as automaticamente.
  - Busca instantanea (atalho `/`), filtros por status (`Lendo`, `Em dia`, `Pausado`, `Concluido`), fixacao no topo, modo Galeria ou Compacto, e alternancia entre **Tema Escuro** (padrao) e **Tema Claro**.
- **Backup Local (`.json`):**
  - **Exportar:** baixa um arquivo `tomo-backup-AAAA-MM-DD.json` com todas as abas, cards, capas, capitulos e notas.
  - **Importar:** valida o arquivo localmente e permite escolher entre **Mesclar com a estante atual** (sem apagar o que ja existe) ou **Substituir toda a estante**.

## Como instalar no Google Chrome

A pasta `dist` ja foi gerada e esta pronta para uso:

1. Abra o Google Chrome e digite `chrome://extensions` na barra de enderecos.
2. No canto superior direito, ative a chave **Modo do desenvolvedor** (*Developer mode*).
3. Clique no botao **Carregar sem compactacao** (*Load unpacked*).
4. Selecione a pasta `dist` dentro deste projeto (`d:\Projetos\Extension\dist`).
5. Pronto! Fixe o icone do **Tomo** (peca de quebra-cabeca no topo direito do Chrome -> icone de alfinete ao lado do Tomo) para salvar paginas com 1 clique.

## Comandos de Desenvolvimento

```bash
# Instalar dependencias
npm install

# Rodar testes automatizados (Vitest)
npm test

# Verificar contraste WCAG AA dos temas Escuro e Claro
npm run verify:contrast

# Gerar pacote de producao na pasta dist/ (para recarregar no Chrome apos edicoes)
npm run build

# Rodar em modo desenvolvimento no navegador
npm run dev
```
