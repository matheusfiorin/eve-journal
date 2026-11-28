# Industrial Intelligence: validação da fonte (0B)

Situação: captura real parcial recebida; **homologação pendente**. Os oito arquivos recebidos tiveram seus hashes
conferidos; faltam os quatro schemas bloqueados por redirects e a revisão completa de cobertura/classificação.
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
Para schemas SDE, aceita também o destino exato `/blobs/<versão da tabela no manifesto>.schema.json`. Essa exceção
não vale para registros nem permite outro hash, query, origem ou release. O SHA-256 dos bytes do schema é calculado
separadamente: a versão da tabela não é apresentada como hash do schema.
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
- nome e versão da tabela do manifesto nos recursos SDE; tabela ausente ou sem versão deixa a captura incompleta;
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

## Primeira captura real: análise parcial

Captura executada pelo colaborador em `2026-11-28T00:37:06.039Z`, release `20261127T110709Z`, build `3754864`.
O relatório e os oito arquivos locais foram lidos e seus SHA-256 recalculados: todos conferem. Manifesto, seis registros
SDE e OpenAPI foram obtidos. Os quatro schemas retornaram redirects que a regra de identidade estrita bloqueou.
O colaborador confirmou HTTP 302 para `types.schema.json`, com `Location` igual a
`/blobs/3dc7b00c365b3ad41774beffb27a741036745e8eae3f8b4ae0aff70f57fbc8d4.schema.json`, exatamente a versão
de `types` no manifesto. A regra inicial era restritiva demais: a correção vincula essa exceção à versão da tabela
selecionada, mantendo o bloqueio dos demais destinos. Recaptura e análise dos schemas reais continuam necessárias.

| Tabela | Versão no manifesto da release capturada |
|---|---|
| `types` | `3dc7b00c365b3ad41774beffb27a741036745e8eae3f8b4ae0aff70f57fbc8d4` |
| `groups` | `82e6a9786ac87d5390cb585850ae343530d53455ae82f602a35f6f633a6dbe35` |
| `categories` | `d18645f30d42450d55a25d8e8cd1c9f57e16fd491c97b00f2233d5daec10fa43` |
| `blueprints` | `cb15f95c63521cd3226716044514417a72dadf9fbca266f6eee328840a4ca3af` |

| Arquivo | SHA-256 dos bytes salvos |
|---|---|
| `sde-manifest.json` | `fa18b25dd11cc2fc45fe009b0879429ffa8f8ce76b52b98aa9b56a39d2a1b996` |
| `types-587.json` | `c4ea36237e2dc2526b2c55d20339b451657e164b76fab7d79b1a38b379678e5f` |
| `types-691.json` | `f01ba41121df884e633b5ae2e1c61cd4e63e98e857c6df884dc978d5879bfa5a` |
| `blueprints-691.json` | `e17eb40df79f9365aa8600acc1804f7a5f108040661cf1785317088398f77f76` |
| `groups-25.json` | `684f0e7ec216f63565f55e4e010172e0d93e1ead17581ca45628a73281c56b17` |
| `categories-6.json` | `429c79e137e287ee8b1d241047ef15959387ee3f5f3bee20d4589ec8ac3710bb` |
| `categories-9.json` | `76048c72285886d65dbbd3cbe1e11cc3b39a9403b7be0813923e49e9f7af5fff` |
| `esi-openapi.json` | `2fb6fe45c1e8f1830f97d86f266472bb1f237b58aa70d749b4ba8112ff5a1e04` |

Constatações dos registros, ainda sem homologação por schema:

- Manifesto: `tables` é um objeto por nome, com `version`, `record.schemaUrl`, `record.urlTemplate` e
  `jsonl.recordSchemaUrl`. Na captura, esses links usam a release explícita. Preservar as versões completas ao mapear.
- IDs nativos: `typeID`, `groupID`, `categoryID`, `blueprintTypeID`; nomes são objetos por idioma. Conversão explícita
  para os nomes internos é necessária. Não presumir disponibilidade de português nas traduções.
- Rifter/type 587 tem `techLevel: 1`, `metaGroupID: 1`, `metaLevel: 0` e `factionID: 500002`.
  **Não usar a mera presença de factionID para excluir como variante de facção.** Ainda validar a taxonomia oficial.
- Receita: `activities.manufacturing`, com `materials`, `products`, `skills` e `time`; itens usam `typeID`.
  Na amostra do blueprint 691, o produto é 587 (quantidade 1), materiais são 34/35/36/37, habilidade 3380 e time 6000.
  Faltam os registros referenciados e a confirmação dos schemas/unidades; não calcular custos com dados incompletos.
- ESI: OpenAPI `3.1.0`, `info.version` e header `X-Compatibility-Date` iguais a `2026-11-19`. A especificação recebida
  descreve `/industry/systems`, `/industry/facilities`, `/markets/prices`, `/markets/{region_id}/orders` e
  `/markets/{region_id}/history`. Isso não equivale a ter recebido respostas operacionais dessas rotas.
- Na especificação, `adjusted_price`, `average_price` e `tax` da instalação são opcionais. Ausência continua desconhecida,
  nunca zero. Ordens regionais usam `page`, `X-Pages`, volume restante, volume mínimo e alcance; preservar essas condições.

Arquivos brutos continuam na pasta de captura local; este registro não altera seus bytes nem inventa fixtures oficiais.

## Verificação desta preparação

- `node --test tests/industrial-capture.test.js tests/industrial-catalog.test.js`: 30/30 aprovados em Node 24.22.3 e 26.13.1.
  Testes incluem release fixa, redirects inconsistentes, hashes/bytes, headers, dados inválidos, limites, erros e preservação.
  A correção acrescentou quatro testes: blob vinculado à versão, rejeição de destinos divergentes, exceção exclusiva
  para schemas e rejeição de tabelas sem versão. As simulações reproduzem a estrutura observada, sem alegar ser capturas.
- Tentativa pública real em 28/11/2026 UTC (27/11 no Brasil): SDE e ESI retornaram `ENOTFOUND`; zero recursos capturados,
  release desconhecida, status incompleto. Isso não comprova indisponibilidade dos serviços fora deste ambiente.
- Antes da alteração, a cópia isolada com LF tinha 417 testes Node: 416 aprovados e uma falha Windows preexistente em
  `tests/package.test.js:126` (`URL.pathname` gera `C:\C:\...`). A correção está na PR #8, separada desta funcionalidade.
- Suíte Node após a correção: 432 testes, 431 aprovados, a mesma falha e zero ignorados (Node 24.22.3).
- Sintaxe: 78 arquivos de produção/scripts aprovados via `node --check`, além do novo arquivo de testes. O comando
  `npm run check` desta base usa um laço Bash e falha no shell Windows; a alternativa portátil está na PR #8.
- Navegador: servidor exclusivo na porta 8137, Chromium, `--grep-invert LIVE: --trace off --workers 2`, suíte completa
  com 248 casos: 233 aprovados, 13 skips previstos e duas falhas conhecidas de clipboard CRLF no Windows, em
  `e2e/pilotfeed.spec.js:21` (desktop/mobile). Não houve falha adicional ou flaky. A expectativa nativa é corrigida na #8.
- Não foram repetidas compilação/testes Android nesta alteração restrita a ferramenta Node e documentação. O bundle
  não mudou; a suíte Node inclui a verificação do bundle. Verificações anteriores das correções Android pertencem às PRs #10/#11.
- Resultados e limitações também ficam na PR da fundação. Não alterar expectativas ou misturar as correções das PRs
  #8, #10 e #11 para ocultar falhas desta base.
