# Ambiente de desenvolvimento

O frontend roda como arquivos estáticos. Os testes usam Node.js, esbuild e Playwright; o cliente Android também precisa
de JDK e Android SDK. Instalar dependências e executar testes locais não exige publicar o site ou alterar o Worker.

## Node e npm no Windows

O CI usa Node 24. Prefira essa versão para reproduzir o CI; o diagnóstico inicial deste computador também executou
Node 26.13.1 e npm 11.20.0. Use a versão do npm que acompanha sua instalação, sem atualizar globalmente por um aviso.

Se o Node foi instalado pelo fnm, inicialize o PowerShell antes de usar os comandos:

```powershell
fnm env --shell powershell | Out-String | Invoke-Expression
fnm use 26.13.1 # versão já instalada neste computador
node --version
npm.cmd --version
```

Essa ativação vale para o terminal atual. Para ativar em novas janelas, adicione a linha de `fnm env` ao perfil do
PowerShell conforme a [documentação do fnm](https://github.com/Schniz/fnm#powershell), preservando o conteúdo existente.
Se o próprio `fnm` não for encontrado após a instalação, feche e abra novamente o terminal e o VS Code.

Na raiz do repositório:

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd test
npm.cmd start
```

O servidor atende em `http://127.0.0.1:8000/`; Ctrl+C o encerra. `npm.cmd` evita depender da execução do arquivo
`npm.ps1` no PowerShell. O comando `check` usa Node diretamente e não exige Bash.

O npm pode avisar sobre scripts de instalação de esbuild e workerd. Verifique as ferramentas antes de autorizar
scripts: neste diagnóstico os binários opcionais de Windows já permitiram executar esbuild e `workerd --version`.
Não foi necessário liberar scripts globalmente. Uma falha `ENOTFOUND` ao baixar pacotes exige resolver o acesso à rede
do terminal que executa o comando; ela não indica uma falha de sintaxe do projeto.

## Testes de navegador

Instale o Chromium do Playwright uma vez e execute a suíte local com dados simulados:

```powershell
npx.cmd playwright install chromium
$env:E2E_PORT = '8137'
npm.cmd run test:e2e -- --trace off --reporter=line --workers 2
```

Use uma porta livre exclusiva da sessão. A configuração inicia e encerra o servidor automaticamente. Os cenários
`LIVE:` ficam fora desse comando; não use credenciais pessoais nos testes simulados. Relatórios e capturas ficam em
`test-results/` e `playwright-report/`, ignorados pelo Git. Se houver falha apenas sob carga, repita com `--last-failed`
e registre os dois resultados. Um navegador que não inicia não equivale a uma suíte aprovada.

## Finais de linha e caminhos

`.gitattributes` mantém JavaScript e YAML em LF, inclusive com `core.autocrlf=true`. Isso conserva as verificações
exatas dos workflows e do bundle Android. As verificações não ignoram diferenças de conteúdo nem regeneram o bundle
durante os testes. A aplicação das regras a arquivos existentes deve acontecer em um checkout limpo; preserve
alterações locais antes de atualizar o checkout. Não é necessário mudar a configuração global do Git.

Se um checkout anterior ainda tiver os antigos finais CRLF, confirme primeiro com `git status` que não há alterações
locais nesses arquivos. Depois de entrar na branch que contém esta correção, atualize somente as cópias de trabalho
que são comparadas literalmente:

```powershell
git restore --worktree -- .github/workflows android/app/src/main/assets/planners.js
```

Esse comando substitui esses arquivos pelo conteúdo da branch atual. Ele deve ser usado apenas depois de preservar
qualquer alteração local. Em um checkout novo, as regras já são aplicadas pelo Git.

URLs `file:` devem ser convertidas com `fileURLToPath` antes de passar um caminho a um subprocesso. Usar `.pathname`
diretamente pode produzir `/C:/...` e manter espaços codificados como `%20` no Windows.
Referências: [atributos de texto do Git](https://git-scm.com/docs/gitattributes) e
[fileURLToPath do Node](https://nodejs.org/api/url.html#urlfileurltopathurl-options).

O clipboard de texto do Windows usa CRLF mesmo quando o código-fonte está em LF. O teste de cópia de EFT compara
todo o texto com a representação nativa esperada: CRLF no Windows e LF nas demais plataformas. A comparação continua
exata, incluindo as linhas em branco; ela não remove caracteres do resultado observado. Referência:
[CF_UNICODETEXT da Microsoft](https://learn.microsoft.com/en-us/windows/win32/dataxchg/standard-clipboard-formats).

## Android

Use JDK 21, como no ambiente de referência do projeto, e Android SDK com `platforms;android-36` e
`build-tools;36.0.0`. Configure `ANDROID_HOME` ou `android/local.properties` com o caminho local do SDK. Esse arquivo é
local e não deve entrar no Git. Veja [android/README.md](../android/README.md) para detalhes de build e assinatura.

O colaborador escolheu instalar apenas as ferramentas de terminal e continuar no VS Code. Os pacotes WinGet foram
conferidos nos manifests de [Temurin 21](https://github.com/microsoft/winget-pkgs/tree/master/manifests/e/EclipseAdoptium/Temurin/21/JDK)
e [Android CLI](https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Google/AndroidCLI).

```powershell
winget install --id EclipseAdoptium.Temurin.21.JDK --exact --source winget
winget install --id Google.AndroidCLI --exact --source winget
```

Após instalar, reabra o terminal e confira `java --version` e `android --version`. Confirme o JDK 21 antes de compilar;
se outra versão estiver primeiro no PATH, selecione a instalação 21 via `JAVA_HOME` para a sessão de build.

O Android CLI permite instalar os componentes necessários em uma pasta separada dos fontes:

```powershell
$env:ANDROID_HOME = 'C:\workspace\android-sdk'
android --sdk="$env:ANDROID_HOME" sdk install platform-tools platforms/android-36 build-tools/36.0.0
```

Siga as solicitações de licença apresentadas pela ferramenta. A configuração usa o caminho explícito do SDK;
não depende de alterar globalmente o PATH. Veja a [referência oficial de android sdk install](https://developer.android.com/tools/agents/android-cli/commands/sdk_install).
O CI atual continua usando seu `sdkmanager` existente; esta orientação de instalação local não altera o pipeline.

Em sessões com acesso de escrita limitado, use uma pasta de cache autorizada para o Gradle, por exemplo
`$env:GRADLE_USER_HOME = 'C:\workspace\eve-gradle-cache'`. O primeiro build precisa baixar Gradle e dependências Maven;
se a rede das ferramentas do assistente estiver restrita, esse download deve acontecer no terminal do colaborador.

```powershell
node scripts/bundle-android.mjs --check
cd android
.\gradlew.bat :app:assembleDebug
.\gradlew.bat :app:testDebugUnitTest
.\gradlew.bat :app:verifyPaparazziDebug
```

O diagnóstico inicial encontrou JDK 19. O colaborador instalou depois Temurin 21.0.13.1+2, validado com `java --version`.
O inicializador Android CLI também foi instalado; a primeira chamada ainda tentou baixar `android-cli.exe` e falhou
na resolução de `dl.google.com` pelas ferramentas do assistente. Esse download e a instalação dos pacotes SDK precisam
ocorrer no terminal do colaborador. O build Android local continua pendente. Os testes Node da ponte JavaScript não
substituem a compilação e os testes JVM/Android.

## Registro da preparação

Na branch inicial de catálogo, com Node 26.13.1 e dependências instaladas, a suíte executou 417 testes: 413 passaram
e quatro falharam. As causas foram CRLF no bundle/workflows e uma URL passada como caminho ao subprocesso. A falha
do antigo `check` no PowerShell é independente desses quatro testes. Esta correção mantém as asserções existentes,
define os finais de linha do checkout e converte o caminho corretamente.

Após aplicar as regras LF na cópia isolada baseada na main `0304702`:

- `npm.cmd run check`: passou, 77 arquivos. O novo verificador rejeitou um arquivo JavaScript inválido em uma pasta
  temporária com espaços, mesmo sendo chamado de outro diretório.
- Suíte Node com 26.13.1: 402 testes, 402 aprovados, zero falhas e zero ignorados.
- Suíte Node com 24.22.3: 402 testes, 402 aprovados, zero falhas e zero ignorados.
- Servidor estático na porta 8137: HTTP 200 para `/`, `/app.js`, `/styles/tokens.css` e `/config.json`.
- Esbuild 0.28.2 executou uma transformação; workerd respondeu `2026-10-23`; CLI Playwright respondeu `1.64.1`.
- Tentativa de iniciar Edge em modo headless: o processo encerrou antes de criar uma página. A suíte de navegador
  ainda não tinha sido executada naquele diagnóstico. A instalação posterior do Chromium permitiu prosseguir.
- Build e testes JVM/Android não executados, pois o SDK ainda não foi localizado.

Os 402 testes são os da base main; os 15 novos testes do catálogo industrial pertencem a uma PR separada. A cópia
original do colaborador permaneceu na branch do catálogo, sem alterações de código desta correção.
Nenhum teste não executado pode ser declarado aprovado. Atualize a PR com as verificações restantes antes do merge.

### Continuidade com Chromium instalado

- O Chromium instalado pelo colaborador iniciou e criou uma página. Nas ferramentas locais, foi necessário apontar
  `PLAYWRIGHT_BROWSERS_PATH` para `C:\Users\ACER\AppData\Local\ms-playwright`, pois a pasta de perfil do processo é isolada.
- A primeira chamada direta da suíte chegou ao último cenário e ficou presa no encerramento. Foi interrompida sem
  relatório conclusivo; ela não é contabilizada como aprovada.
- Com um servidor estático iniciado e encerrado diretamente pelo processo de validação, a execução na branch do
  catálogo concluiu: 233 aprovados, 13 ignorados e 2 falhos. As duas falhas eram a expectativa LF para o texto do
  clipboard Windows. O servidor usou a mesma porta exclusiva 8137 e os mesmos fontes da suíte.
- Após corrigir a expectativa para a representação nativa, os dois cenários de cópia de EFT passaram no reteste.
- Suíte completa na cópia corrigida da PR de ambiente: 248 casos coletados, **235 aprovados, 13 ignorados, zero falhas
  e zero flaky**, com Chromium/Playwright 1.64.1, Node 26.13.1, dois workers e porta 8137. Os 13 ignorados são os casos
  condicionais da própria suíte; esta correção não acrescentou nenhum skip.
- As validações de aplicação/navegador e Android do GitHub passaram no commit de código `30505e3` da PR de ambiente;
  ambas também passaram no commit `dff6ab3` da PR do catálogo. Isso é evidência do CI Linux, não de um build Android local.
- A preparação local Android segue a escolha de ferramentas de terminal: JDK 21 foi instalado e validado. A primeira
  inicialização completa do Android CLI e os pacotes SDK continuam pendentes de download no terminal do colaborador.
