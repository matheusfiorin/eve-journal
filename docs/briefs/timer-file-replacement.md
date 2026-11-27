# Persistência de atualizações dos timers

## Problema e resultado

No teste Windows de 27/11/2026, um timer movido de Tama para Jita voltava a Tama ao reabrir o armazenamento.
O primeiro arquivo era gravado, mas `File.renameTo` não substituía o destino existente; seu retorno era ignorado.
Alterações e remoções seguintes podiam deixar dados antigos no disco.

O armazenamento deve conservar a última lista completa após atualizações e remoções, inclusive em um reinício.

## Decisão

- Manter a serialização, o arquivo temporário no mesmo diretório e o mutex que ordena as gravações.
- Substituir o destino com `Files.move`, tentando `ATOMIC_MOVE` e `REPLACE_EXISTING`.
- Quando o provedor não suporta movimento atômico, usar `REPLACE_EXISTING` como fallback. Não prometer atomicidade
  nesse fallback; outras falhas de I/O mantêm o tratamento existente.
- APIs NIO utilizadas existem desde Android 26; o aplicativo tem minSdk 29.
- A alteração afeta apenas o armazenamento local dos timers. O teste de regressão usa timers privados e verifica
  que não há envio de upsert/remove à sala.

## Verificação

O caso existente `newTimersStartWhereTheOwnerIsUnlessToldOtherwise` detectou a perda da atualização. O novo caso
`replacingAndRemovingSavedTimersSurvivesRestart` verifica gravação inicial, substituição por uma nova localização e
remoção persistida, reabrindo o arquivo em cada etapa. Registrar na PR os resultados locais e do CI.

Esta correção tem PR própria. A preparação Windows e os ajustes de locale de screenshots pertencem à PR de ambiente;
a formatação de quantias tem outra PR. Resultados de validação conjunta devem identificar essa composição.

Validação inicial na cópia com as três correções: `TimersTest`, 11 testes aprovados; mais `AmountFormatTest`,
`SessionSnapshotTest` e `SettingsSnapshotTest`, total de 21 aprovados, zero falhas e zero ignorados.
A sessão usou JDK 21.0.13.1, Gradle 9.9.2 offline e carregamento antecipado do agente Byte Buddy já presente no cache
para evitar a falha de attach da sessão restrita. A suíte completa e o build são registrados na PR ao concluir.

## Referências

- [File.renameTo](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/io/File.html#renameTo(java.io.File)):
  substituição de destino depende da plataforma e o retorno precisa ser verificado.
- [Files.move](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/nio/file/Files.html#move(java.nio.file.Path,java.nio.file.Path,java.nio.file.CopyOption...)):
  opções de substituição, atomicidade e exceção quando não suportada.
- [Files no Android](https://developer.android.com/reference/java/nio/file/Files).
