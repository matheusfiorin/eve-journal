# Formatação de quantias editáveis independente do locale

## Problema e resultado

`formatAmount` prepara valores para o formulário que `parseAmount` interpreta. A gramática documentada usa ponto
decimal (`12.5m`, `1.25b`) e aceita vírgulas como separadores de agrupamento.

Com locale pt-BR, a formatação padrão da JVM produzia `12,5m`. Ao interpretar esse texto, o parser removia a vírgula
e obtinha 125 milhões em vez de 12,5 milhões. O teste existente falhou com `12.5m` versus `12,5m` no Windows.

## Decisão

Usar `Locale.ROOT` na conversão decimal dos tokens do formulário. Preservar sufixos, sinal, precisão de três casas,
remoção de zeros finais e regras atuais de arredondamento/seleção da unidade. A gramática de entrada e o payload
numérico continuam os mesmos. O locale de apresentação de datas e demais números não é redefinido pela aplicação.

## Verificação

O novo teste `AmountFormatTest.formattedAmountsKeepTheirValueInEveryDeviceLocale` muda explicitamente o locale entre
en-US, pt-BR, de-DE e ar-EG. Verifica o texto completo e `parseAmount(formatAmount(valor)) == valor`, incluindo valores
negativos, bilhões, milhões fracionários, milhares e inteiros sem sufixo. O locale original é restaurado ao final.

O teste não depende do locale padrão em que o CI inicia a JVM. Registrar resultados na PR, distinguindo testes
individuais da execução conjunta com a correção de persistência e com o ambiente dos snapshots.

Validação inicial na cópia com as três correções: teste de quatro locales aprovado, os 8 testes de
`SessionSnapshotTest` aprovados e 21 testes focados no total, zero falhas e zero ignorados. Execução offline com JDK
21.0.13.1 e Gradle 9.9.2. O agente Byte Buddy já presente no cache foi carregado na inicialização da JVM nessa sessão
restrita; nenhuma dependência ou exceção de teste foi acrescentada. Registrar a suíte completa na PR ao concluir.

## Referências

- [Locale.ROOT](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Locale.html#ROOT).
- [String.format com locale explícito](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/String.html#format(java.util.Locale,java.lang.String,java.lang.Object...)).
