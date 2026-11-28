# Industrial Intelligence: validação da fonte (0B)

Situação: preparação da captura implementada; **homologação pendente**. Não há payload real homologado nesta entrega.
Os testes do capturador usam respostas HTTP sintéticas, identificadas como tal no código. O contrato normalizado em
`industrial-catalog.js` continua interno; ele não recebe JSON nativo da CCP sem um adaptador explícito.

## Fontes e decisões

- [SDE HTTP oficial](https://developers.eveonline.com/docs/services/static-data/): manifesto em
  `https://sde.evetech.net/tranquility/latest/`, schemas `<table>.schema.json` e registros `<table>/<key>.json`.
  Resolver o manifesto uma vez e fixar todas as consultas seguintes na sua `release`. Build number não identifica
  uma release; somente as duas gerações mais recentes são retidas. A versão de cada tabela pertence ao manifesto.
- [Anúncio da API](https://developers.eveonline.com/blog/the-sde-over-http-static-data-dynamically).
- [ESI e compatibilidade](https://developers.eveonline.com/docs/services/esi/overview/): a captura diagnóstica usa
  `2026-11-19` no header `X-Compatibility-Date` e no parâmetro `compatibility_date`. Isso não muda a data ESI dos
  consumidores existentes. A rota `https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-11-19` usa o endereço
  OpenAPI 3.1 vinculado no [anúncio oficial da migração](https://developers.eveonline.com/blog/changing-specs-from-swagger-to-openapi).
  O conteúdo nessa data ainda precisa ser obtido e revisado; o endereço documentado não comprova um schema homologado.
  O script aceita JSON e `application/openapi+json`. Não usar Swagger antigo como substituto: sua remoção foi
  [anunciada pela CCP](https://developers.eveonline.com/blog/goodbye-swagger-removing-the-last-remnants).

`scripts/capture-industrial-contracts.mjs` faz apenas GET público, sem SSO, tokens, dados dos pilotos ou escrita no
pipeline. Não é o coletor incremental de produção. Não publica snapshots nem marca a fonte como homologada.
Segue somente redirects dentro da origem oficial; depois do manifesto, rejeita mudança de identidade dos recursos.
Se uma release desaparecer durante a coleta, preserva a falha; uma nova execução começa outra captura, sem misturar dados.

## Executar a captura

Com Node instalado, na cópia da branch de trabalho:

```powershell
node scripts/capture-industrial-contracts.mjs --output 'C:\workspace\eve-sde-captures'
```

O diretório de saída é obrigatório. Cada execução cria uma subpasta exclusiva e preserva os arquivos anteriores.
Também aceita `--release YYYYMMDDTHHMMSSZ` para fixar uma release conhecida e `--record typeDogma:587` para acrescentar
uma sonda e o schema da tabela correspondente (até 24 sondas adicionais). IDs são inteiros positivos seguros.
Esses nomes e IDs são sondas de investigação; a existência e o conteúdo efetivo precisam ser confirmados no manifesto.

A coleta inicial pede schemas de `types`, `groups`, `categories` e `blueprints`; os registros de referência são
`types:587`, `types:691`, `blueprints:691`, `groups:25`, `categories:6` e `categories:9`. É um conjunto pequeno para
inspeção inicial, **não uma lista permitida de naves nem cobertura completa das classificações aprovadas**.
Rifter/type 587 é o exemplo da documentação SDE; as demais sondas não foram verificadas ao vivo nesta entrega.
É necessário ampliar as amostras após examinar o manifesto e os schemas reais, incluindo dogma/taxonomia quando necessário.

## Evidências preservadas

O arquivo `capture-report.json` registra:

- URL pedida e final, redirects, horário UTC de cada recurso e release escolhida;
- tamanho, SHA-256 e headers públicos selecionados (`ETag`, `Last-Modified`, tipo/codificação, cache e data ESI);
- erros HTTP, de rede, limites ou JSON inválido. Um JSON inválido recebido dentro do limite é salvo para análise;
- `status: captured` somente se todas as sondas terminarem sem erro, sempre com `homologation: pending-review`.

O hash corresponde aos bytes exatos do arquivo salvo, após a descompressão feita pelo Fetch; não é um hash dos bytes
gzip transportados. O manifesto original é preservado para inspecionar versões e links sem adivinhar seu formato.
Cookies e headers de autenticação não entram no relatório. Limites: 30 segundos por requisição, no máximo seis saltos,
8 MiB descomprimidos por recurso e 32 MiB de arquivos de resposta por captura. Não há repetição automática de 429.
Falhas de rede produzem relatório incompleto e exit code 1. Erros locais de escrita encerram a execução com erro.

Não commitar capturas em massa. Após revisão, selecionar fixtures mínimas e oficiais, mantendo fontes, release,
versões de tabela e hashes reproduzíveis. Arquivos capturados não são executados pelo script.

## Critérios para encerrar 0B

1. Obter arquivos reais sem falhas, conferir URLs, release única, hashes e versões das tabelas no manifesto.
2. Inspecionar schemas e chaves nomeadas; mapear nome/publicação, grupos/categorias, receitas, produtos, materiais,
   quantidades, habilidades e tempo para o contrato interno. Ausência de atividade não vira receita vazia válida.
3. Identificar metadados oficiais para T1/T2/T3, facção/especiais e capital/subcapital; acrescentar amostras reais
   representativas e casos negativos. Não derivar classificação de nomes traduzidos, preço ou uma lista fixa de naves.
4. Confirmar na especificação ESI os contratos públicos que serão necessários para preços ajustados, índices,
   instalações, livros e histórico; registrar unidades, paginação, validade, limites e dependências por etapa.
5. Selecionar fixtures reais com procedência e testes de campos ausentes/alterados e do mapeamento. Somente então
   declarar 0B concluída e iniciar o adaptador, cache e publicação atômica da etapa 1.

Capturar arquivos não encerra esses critérios. A captura inicial não testa ainda todas as tabelas, registros de classes
de naves ou respostas operacionais ESI. Não foi alterada a tela Build, o bundle Android, as fórmulas ou o banco.

## Verificação desta preparação

- `node --test tests/industrial-capture.test.js tests/industrial-catalog.test.js`: 26/26 aprovados em Node 24.22.3 e 26.13.1.
  Testes incluem release fixa, redirects inconsistentes, hashes/bytes, headers, dados inválidos, limites, erros e preservação.
- Tentativa pública real em 28/11/2026 UTC (27/11 no Brasil): SDE e ESI retornaram `ENOTFOUND`; zero recursos capturados,
  release desconhecida, status incompleto. Isso não comprova indisponibilidade dos serviços fora deste ambiente.
- Antes da alteração, a cópia isolada com LF tinha 417 testes Node: 416 aprovados e uma falha Windows preexistente em
  `tests/package.test.js:126` (`URL.pathname` gera `C:\C:\...`). A correção está na PR #8, separada desta funcionalidade.
- Suíte Node após a alteração: 428 testes, 427 aprovados, a mesma falha e zero ignorados (Node 24.22.3).
- Sintaxe: 78 arquivos de produção/scripts aprovados via `node --check`, além do novo arquivo de testes. O comando
  `npm run check` desta base usa um laço Bash e falha no shell Windows; a alternativa portátil está na PR #8.
- Navegador: servidor exclusivo na porta 8137, Chromium, `--grep-invert LIVE: --trace off --workers 2`, suíte completa
  com 248 casos: 233 aprovados, 13 skips previstos e duas falhas conhecidas de clipboard CRLF no Windows, em
  `e2e/pilotfeed.spec.js:21` (desktop/mobile). Não houve falha adicional ou flaky. A expectativa nativa é corrigida na #8.
- Não foram repetidas compilação/testes Android nesta alteração restrita a ferramenta Node e documentação. O bundle
  não mudou; a suíte Node inclui a verificação do bundle. Verificações anteriores das correções Android pertencem às PRs #10/#11.
- Resultados e limitações também ficam na PR da fundação. Não alterar expectativas ou misturar as correções das PRs
  #8, #10 e #11 para ocultar falhas desta base.
