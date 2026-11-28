# Industrial Intelligence — escopo aprovado e contrato do catálogo

Este documento registra as decisões dos fundadores e orienta as entregas do analisador industrial. O código atual
de Build continua sendo um planejador inicial; este documento não declara que o novo simulador esteja disponível.

## Decisões aprovadas

- Web e Android, com um único motor JavaScript reutilizado pela ponte QuickJS. Sem trocar framework, banco ou hospedagem.
- Instalações configuráveis: compra, fabricação e venda são locais independentes. Validar primeiro uma estação NPC;
  Kisogo/Jita são possibilidades, não constantes. O nome exato da instalação será informado no primeiro cenário real.
- Descobrir o catálogo T1 fabricável por metadados/receitas oficiais, sem lista fixa de naves e sem limite por preço de BPO.
  Habilitar cálculos por regras verificadas. Capitais, facção e especiais têm classificação explícita; capitais não entram
  automaticamente no primeiro simulador. T2, T3, invenção e produção recursiva ficam fora do MVP.
- Materiais próprios têm custo de oportunidade: valor líquido de venda, respeitando profundidade e taxas. Separar custo
  econômico, desembolso e capital imobilizado. Minério bruto não substitui mineral refinado na receita.
- Logística manual por lote, com origem/destino e valores desconhecidos identificados. Zero somente quando informado.
  Bônus e taxas pertencem ao perfil da instalação. Risco de transporte é indicador separado.
- Ranking explicável: lucro econômico, margem, capital, lucro por hora de slot e liquidez regional. Sem pesos ocultos ou
  participação fixa de mercado; operação deficitária/incompleta não é uma oportunidade positiva.
- Rascunhos privados; compartilhamento voluntário com a wing e prévia do conteúdo. Preservar as premissas e cotações da
  revisão compartilhada. Recalcular cria nova revisão. Não anexar automaticamente carteira, estoque ou localização atuais.
- Cada funcionalidade: branch, commits, Markdown atualizado e PR para `main`. Envio da branch autorizado; merge depende
  de revisão/autorização. Entregas parciais ou com validação pendente ficam em Draft PR.

## Etapas e situação

| Etapa | Entrega | Situação |
|---|---|---|
| 0A | Escopo e contrato interno normalizado do catálogo, com testes sintéticos | Implementado nesta entrega |
| 0B | Homologação de respostas/schemas reais da API HTTP SDE e da especificação ESI | Em andamento: capturador diagnóstico testado; coleta e revisão de dados reais pendentes por falha DNS no ambiente |
| 1 | Adaptador SDE, coleta incremental, publicação atômica e cache | Planejado, depende de 0B |
| 2 | Simulador de um lote: jobs, ME/TE, custos econômicos e capital | Planejado |
| 3 | Profundidade de mercado, venda imediata/ordem e histórico regional | Planejado |
| 4 | Ranking e cenários conservador/base/otimista com premissas explícitas | Planejado |
| 5 | Interfaces Build na web/Android e planos compartilhados versionados | Planejado |

## Primeira entrega: `industrial-catalog.js`

`buildIndustrialCatalog(snapshot)` é puro: não consulta APIs, não escreve arquivos, não usa relógio global e não depende
do DOM. Pode ser usado pelo pipeline, Node e pelos clientes, após integração explícita. O catálogo não alimenta a tela
Build nem altera o pipeline nesta entrega. Não há novas migrações, endpoints, scopes ou dependências.

**O contrato abaixo é interno, não é o JSON nativo da nova API SDE.** Não passar respostas HTTP/ZIP diretamente para ele.
Um adaptador futuro deve validar o schema da fonte e converter os campos explicitamente. As fixtures dos testes são
sintéticas, não capturas oficiais. Nenhum teste desta entrega comprova a compatibilidade de um payload HTTP real.

### Entrada normalizada

- `source`: `provider: 'ccp-sde'`, `tenant: 'tranquility'`, `release` no formato `YYYYMMDDTHHMMSSZ`, `retrievedAt` com fuso.
- `tables`: `types`, `groups`, `categories`, `blueprints`. Cada uma carrega `release`, `version` (string normalizada) e `rows`.
  Caches reaproveitados devem ser confirmados pelo adaptador como parte da release selecionada; não basta renomear a release.
- IDs e quantidades são inteiros positivos seguros para JavaScript. IDs duplicados tornam a geração ambígua e são rejeitados.

| Registro | Campos internos |
|---|---|
| Tipo | `id`, `name`, `groupId`, `published`; para naves, `techLevel` e `variant` |
| Grupo | `id`, `name`, `categoryId`; para naves, `shipClass` |
| Categoria | `id`, `name`, `kind` (por exemplo `ship`, `material`, `blueprint`) |
| Blueprint | `id`, `manufacturing: null` ou uma atividade normalizada |
| Fabricação | `products: [{typeId, quantity}]`, `materials: [{typeId, quantity}]`, `skills: [{typeId, level}]`, `timeSeconds` |

`variant` distingue `standard`, `faction`, `special` e desconhecido. `shipClass` distingue `subcapital`, `capital` e
desconhecido. Esses campos semânticos precisam ser produzidos pelo adaptador a partir de metadados oficiais, incluindo
dogma quando necessário. Não inferir pelo nome traduzido, preço ou capacidade financeira do piloto.

### Saída e qualidade

- `version: 1`: versão deste contrato, diferente de release SDE e de versão futura das fórmulas.
- `source`: tenant, release, horário de coleta e versões das quatro tabelas normalizadas.
- `entries`: ordenadas por produto/blueprint, com quantidades-base, tempo, habilidades e classificação.
- `status: 'recipe-ready'`: receita estruturalmente completa; **não significa lucro, mercado disponível, homologação no
  jogo, habilidades possuídas, instalação compatível ou disponibilidade de um exemplar de BPO/BPC**.
- `status: 'incomplete'`: materiais, classificações, metadados ou requisitos desconhecidos/inválidos; motivos em `issues`.
- `status: 'unsupported'`: receita completa cuja classe ainda não é habilitada (capitais).
- `issues` no catálogo: receitas sem produto classificável ou com múltiplas saídas. Não escolher silenciosamente a primeira.
- `excluded`: contagem de não fabricáveis, não naves, não publicados, não T1 e variantes fora do recorte básico.
- `counts`: totais por estado. Dados ausentes não viram zero nem resultados financeiros.

A receita guarda materiais intermediários como entradas de mercado; não expande fabricação recursiva. Várias receitas
para um produto permanecem distintas por blueprint. Eficiências e runs de exemplares de BPC não pertencem a este catálogo.

## Fontes e bloqueios de homologação

- [SDE HTTP oficial](https://developers.eveonline.com/docs/services/static-data/)
- [Anúncio de 19/11/2026](https://developers.eveonline.com/blog/the-sde-over-http-static-data-dynamically)
- [ESI e datas de compatibilidade](https://developers.eveonline.com/docs/services/esi/overview/)

Resolver `latest` uma vez, manter a release para todas as tabelas, usar ETag/versão e publicar só uma geração consistente.
Build não é identificador único de release. Apenas as duas releases mais recentes são retidas pelo serviço; conservar o
subconjunto normalizado e hashes necessários à reprodução. Não atribuir o novo schema ao ZIP: `_key` mudou para chaves
nomeadas. Não avançar globalmente a data ESI antes de migrar os consumidores de dados estáticos.

Para encerrar 0B: capturar manifesto, schemas e registros representativos oficiais; registrar release/versões/hashes e
origem; testar ausência/alteração de campos e comparar o mapeamento com o schema. Só então implementar o adaptador real.
Estas consultas públicas não exigem credenciais pessoais. Manter os avisos e termos aplicáveis da CCP.

Preparação e critérios detalhados: [validação da fonte](industrial-source-validation.md). O script diagnóstico
`scripts/capture-industrial-contracts.mjs` preserva respostas e procedência em pasta explícita, fora do pipeline.
Mesmo uma captura sem erros permanece pendente de revisão. Seus testes HTTP são sintéticos, não fixtures oficiais.

## Critérios das próximas entregas

- Preço ajustado, índice, material ou livro desconhecido produz resultado incompleto, nunca custo zero presumido.
- Quantidades/arredondamento por job; BPC por exemplar; tempo de slot separado de prazo decorrido e de prazo de venda.
- EIV com materiais-base e preços ajustados; parâmetros tributários com fonte/data. Resolver a divergência documental
  Alpha no cliente antes de homologar o perfil. Pesquisa e fabricação não compartilham taxas por suposição.
- Compra/venda por profundidade e regras de elegibilidade. Histórico é regional; preço anunciado não é receita realizada.
- Definir denominadores de margem e ROI; investimento em BPO separado de despesas operacionais.
- Reconciliar um lote real no EVE antes de divulgar ranking. Não ajustar constantes para esconder divergências.
- Preservar as regras atuais de consentimento. O motor básico funciona com dados públicos e parâmetros manuais.

## Validação e registro de cada PR

Testes específicos em `tests/industrial-catalog.test.js`; rodar também os checks de sintaxe e a suíte Node. Mudanças de
interface exigem E2E; mudanças da ponte Android exigem regenerar o bundle, testes de paridade e verificações Android.
Executar a suíte completa de navegador conforme as regras do projeto quando as dependências estiverem disponíveis.
Registrar resultados reais e impedimentos; não omitir, enfraquecer ou declarar testes não executados como aprovados.

O relatório da PR deve informar base/escopo, comportamento entregue, arquivos relevantes, decisões, testes, limitações e
próximo passo. A primeira PR é parcial até homologar a fonte e integrar o coletor; ela não entrega ainda a análise financeira.
