# Plano de melhorias do Mailclaw

Resultado de três passadas de análise do repositório (novembro de 2026). Cada item traz o arquivo onde o problema foi confirmado. O estado de cada item fica na coluna "Estado" das tabelas; atualize ao concluir.

A terceira passada (16/11/2026) cobriu só desempenho e infraestrutura Cloudflare: Worker, filas, D1, requisições do navegador e o runtime Node. Está na Fase 6, com a ordem de trabalho na Etapa 5.

Verificações automáticas na data da análise: `npx tsc --noEmit` sem erros; `npm run lint` com 0 erros e 84 avisos; `node --test` com 675 de 678 testes passando (2 pulados de propósito, 1 falha por depender do binário `openssl`); `npm audit` com 30 vulnerabilidades (9 altas).

Depois da segunda rodada de correções (17/11/2026): `npx tsc --noEmit` sem erros; `npm run lint` com 0 erros e 0 avisos; `node --test` com 904 de 906 testes passando (2 pulados de propósito, 0 falhas); `npm audit --omit=dev` sem vulnerabilidades, `npm audit` com 6 (todas de desenvolvimento, ver 4.6); `npm run build` completo. O resumo está em "Andamento".

Depois da terceira rodada (17/11/2026): `npx tsc --noEmit` sem erros; `npm run lint` com 0 erros e 0 avisos; `node --test` com 1.090 de 1.092 testes passando (2 pulados de propósito, 0 falhas); `npm audit` sem vulnerabilidades, inclusive de desenvolvimento; `npm run build` completo com `vinext` 1.4.2, e o Worker sobe no `vp preview`.

## Prioridades após a primeira instalação em produção (16/11/2026)

A primeira instalação real (Cloudflare, plano Workers Free, recebimento pela Cloudflare e envio pelo Resend) mostrou problemas que a leitura do código não tinha mostrado. Esta seção define a ordem de trabalho; os números entre parênteses remetem aos itens das fases abaixo.

### Etapa 1: publicar o que já está pronto

| # | Item | Estado |
|---|---|---|
| P1.1 | Fazer commit e push da primeira rodada de correções (2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.5), que está só na cópia local; a produção roda sem elas. | Feito (17/11/2026: merge no `main` e push, com as três rodadas; filas `mailclaw-inbound-dlq` e `mailclaw-outbound-dlq` criadas antes) |
| P1.2 | Rodar `tsc`, lint e a suíte antes do push. `sweepStuckOutboundJobs`, `requeueScheduledOutboundJobs` e a nova ordem em `deliverEmail` não têm teste próprio. | Feito (`tests/outbound-delivery.test.mjs`) |

### Etapa 2: decidir se o plano gratuito aguenta

Suspeita, ainda sem medição. O plano Workers Free limita cada requisição a 10 ms de CPU.

| # | Item | Onde | Estado |
|---|---|---|---|
| P2.1 | Confirmar a causa do erro 1102 visto em `/inbox`: filtrar `EXCEEDED_CPU` em Observability, nas requisições e nas execuções da fila. | Painel da Cloudflare | Pendente (só no painel da Cloudflare) |
| P2.2 | Medir o tempo de CPU do login (bcrypt custo 12 síncrono), de `/inbox` e do processamento de um e-mail recebido com anexo. | `src/lib/auth/password.ts`, `src/lib/email/inbound.ts` | Parcial (medido só localmente; ver Medições) |
| P2.3 | Tratar o item 2.1 como prioridade máxima: um estouro de CPU no consumidor da fila, somado à falta de dead-letter queue, perde o e-mail recebido em silêncio após 3 tentativas. | `wrangler.jsonc`, `src/lib/email/raw-sweeper.ts` | Feito (ver 2.1) |
| P2.4 | Com os números, decidir: se a fila estoura, o Workers Paid é requisito para uso real e a documentação deve dizer isso. | `README.md`, `docs/deployment.md` | Feito (Paid recomendado na documentação; a decisão é de quem instala) |

### Etapa 3: consertar o que quebrou na instalação

| # | Problema encontrado | Correção | Onde | Estado |
|---|---|---|---|---|
| P3.1 | `npm ci` falhou no build da Cloudflare (npm 10 rejeitou o lockfile gerado com npm 11). Contornado com `@types/node` 24. | Fixar a mesma versão de Node no CI (hoje 22) e no build da Cloudflare (24), e descobrir por que o CI, que roda `npm ci` com npm 10, não barrou o lockfile. | `.github/workflows/checks.yml`, `package.json` | Parcial (falta proteger o branch `main` no GitHub) |
| P3.2 | O deploy falhou porque o bucket R2 não existia; o Wrangler só o cria quando o R2 já está ativado na conta. | Documentar a ativação do R2 como pré-requisito do primeiro deploy. | `README.md`, `docs/deployment.md` | Feito |
| P3.3 | Habilitar o envio pela Cloudflare no plano gratuito devolve 401 (código 2036) com uma dica sobre registros MX. | Incluir na dica a causa mais comum: o envio pela Cloudflare exige Workers Paid. | `src/lib/cloudflare-api-utils.ts` | Feito |
| P3.4 | Esse 401 bloqueia a criação da conta no setup. | Quando o envio falhar por autorização, concluir como "só recebimento" e avisar. | `src/lib/domains/provision.ts`, `src/app/(auth)/register/register-client.tsx` | Feito |
| P3.5 | Confusão entre o token de build, criado automaticamente pela Cloudflare, e o `CF_TOKEN` de execução. | Explicar que são dois tokens e atualizar o passo a passo para a tela nova de criação (políticas de conta e de zona). | `docs/deployment.md` | Feito |
| P3.6 | O README promete receber e enviar de graça sem citar os limites. | Dizer o que o Workers Free cobre: envio só via Resend ou SES, e limite de CPU. | `README.md` | Feito |
| P3.7 | O deploy avisa que `workers_dev` e `preview_urls` ficam ligados por padrão; as URLs de preview são públicas. | Definir os dois explicitamente. | `wrangler.jsonc`, `wrangler.jsonc.example` | Feito |

### Etapa 4: segurança e dependências

Na ordem: 1.3 (tentativas de MFA), 1.1 (token de sessão no `localStorage`), 4.6 (dependências vulneráveis; o Wrangler está na 4.142 e existe a 4.163) e 3.7 (timeout nas chamadas externas, mais relevante agora que o envio depende do Resend). As fases 3 e 5 ficam para depois.

### Etapa 5: desempenho e Cloudflare

Os itens estão na Fase 6. A ordem abaixo põe primeiro o que reduz CPU e leituras do D1 com pouca mudança de código, porque é isso que decide a Etapa 2.

| Ordem | Itens | Por que primeiro |
|---|---|---|
| 1 | 6.1, 6.2 | O e-mail recebido é parseado duas vezes e cinco mensagens dividem uma invocação. É o candidato mais forte a estourar CPU na entrada (P2.3). |
| 2 | 6.16 | Uma linha no cron diário (`PRAGMA optimize`) tira três varreduras de caixa inteira do caminho de todo e-mail recebido e de toda página de conversas. |
| 3 | 6.4, 6.24 | CPU gasto em toda requisição: o Drizzle é remontado a cada `getDb()` e o catálogo pt-BR de 155 KB é reprocessado em todo HTML. Candidatos ao erro 1102 de `/inbox` (P2.1). |
| 4 | 6.10, 6.11, 6.12, 6.13 | Configuração da Cloudflare, sem código ou quase. |
| 5 | 6.17, 6.18, 6.19 | Consultas que leem a pasta ou a caixa inteira; exigem migração nos três dialetos. |
| 6 | 6.23 a 6.30 | Requisições que o navegador faz sem precisar; pesam na cota de 100 mil por dia. |
| 7 | O resto da Fase 6 | Ganhos menores ou restritos ao Docker. |

Medição local de P2.2 já feita (Node 24, máquina de desenvolvimento; ver "Medições" na Fase 6): uma verificação de senha custa cerca de 750 ms de CPU e o parse de um e-mail com anexo de 1 MB, 30 ms. Os dois passam muito dos 10 ms do plano gratuito. Falta medir no Workers.

### Não verificado nesta rodada

Na segunda rodada, `tsc`, lint, a suíte e o build rodaram de novo (números no topo). Continuam sem verificação: qualquer medição no Workers de produção, o CI no GitHub com o workflow novo, MySQL real (só SQLite e PostgreSQL via PGlite foram executados) e o uso logado no navegador. O Worker gerado subiu localmente e respondeu em pt-BR com o catálogo fora do HTML, 401 sem sessão, 403 em POST de outro site e a CSP nova.

## Fase 1: segurança da sessão

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 1.1 | O token de sessão é devolvido no JSON do login e gravado em `localStorage`, o que anula o cookie `httpOnly`: qualquer XSS rouba uma sessão de 30 dias. Usar só o cookie no navegador; manter o token no corpo apenas para o app móvel. O cliente usa o token também como marcador de "qual conta está ativa" (troca de conta, invalidação de cache), então é preciso um marcador não secreto no lugar. | `src/lib/auth/client.ts`, `src/lib/auth/login-response.ts` | Médio | Feito |
| 1.2 | O HTML dos e-mails é exibido na mesma origem do app (Shadow DOM + DOMPurify) e a CSP permite `'unsafe-inline'` em scripts. Trocar por CSP com nonce ou iframe com `sandbox`. | `src/components/messages/email-html-renderer.tsx`, `src/lib/security/headers.ts` | Grande | Feito (iframe `srcdoc` com `sandbox` sem `allow-scripts` e CSP própria; testado no Chrome. Nonce no app fica como opção, ver `docs/security.md`) |
| 1.3 | O código MFA de 6 dígitos pode ser tentado várias vezes no mesmo desafio de 5 minutos, limitado só por IP. Adicionar contador de tentativas ao desafio (exige migração nos três dialetos). | `src/app/api/auth/mfa/verify/route.ts`, `src/lib/auth/login-challenge.ts` | Pequeno | Feito |

## Fase 2: confiabilidade do e-mail

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 2.1 | E-mail recebido perdido em silêncio: sem dead-letter queue, após 3 tentativas a mensagem some da fila e o original é apagado em 24 horas. | `wrangler.jsonc`, `src/lib/email/raw-sweeper.ts` | Médio | Feito |
| 2.2 | Envio agendado travado: o job vira `sending` antes de carregar os anexos e nada o devolve à fila. | `src/lib/email/send.ts` | Pequeno | Feito |
| 2.3 | Mensagem enviada marcada como "falhou": um erro em webhook ou log de auditoria depois do envio cai no `catch` que marca `failed`. | `src/lib/email/send.ts` | Pequeno | Feito |
| 2.4 | Fila em memória no Docker: reiniciar perde envios agendados e e-mails pendentes; nada é recuperado na partida. | `server/runtime/queue.ts`, `server/index.ts` | Médio | Feito |
| 2.5 | SMTP com vários destinatários: a rejeição de um devolve 550 para a mensagem inteira, mesmo já entregue aos outros; uma falha temporária em um refaz os encaminhamentos dos demais. | `server/runtime/smtp.ts` | Médio | Feito |
| 2.6 | Encaminhamento da conta acontece antes de gravar o original; uma falha na gravação duplica o encaminhamento. | `worker.ts`, `src/lib/email/intake.ts` | Pequeno | Feito |
| 2.7 | O salvamento automático de rascunho ignora respostas de erro e não avisa o usuário. | `src/components/compose/compose-form.tsx` | Pequeno | Feito |
| 2.8 | Webhooks são entregues dentro do processamento (até 10 s cada, em sequência). Enfileirar a primeira tentativa. | `src/lib/email/webhooks.ts` | Médio | Feito |

## Fase 3: defeitos pontuais da API

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 3.1 | `limit` negativo ou inválido: `Math.min(Number(limit), 100)` aceita `-1` e `NaN` em cinco rotas. No SQLite, `LIMIT -1` significa sem limite. | `src/app/api/messages/route.ts`, `v1/messages`, `activity`, `audit-logs`, `webhooks/[id]/deliveries` | Pequeno | Feito |
| 3.2 | Laço sem pausa no JMAP: `ping=abc` vira `NaN` e o servidor consulta o banco em sequência. | `src/lib/jmap/handler.ts` | Pequeno | Feito |
| 3.3 | Rotas que respondem 500 em vez de 401: `requireUser` aparece 72 vezes em 41 arquivos. Migrar para `requireSessionUser`. | `src/app/api/**` | Médio | Feito |
| 3.4 | Corpo de requisição sem validação (cast direto do JSON; JSON malformado vira 500). | `src/app/api/messages/bulk/route.ts`, `src/app/api/calendar/events/[eventId]/route.ts` e outras | Médio | Feito |
| 3.5 | Upload JMAP lê o corpo inteiro antes de checar o limite de tamanho. | `src/lib/jmap/handler.ts` | Pequeno | Feito |
| 3.6 | Marcadores `relay-seen/` e `sns-seen/` nunca são apagados do armazenamento. | `src/app/api/inbound/route.ts`, `src/app/api/inbound/ses/route.ts` | Pequeno | Feito |
| 3.7 | Chamadas externas sem timeout (Cloudflare, AWS, Resend, push). | `src/lib/cloudflare-api.ts`, `src/lib/aws/client.ts`, `src/lib/email/resend-api.ts`, `src/lib/email/outbound-provider.ts` | Pequeno | Feito |
| 3.8 | Ação em massa `spam` processa até 5.000 mensagens em sequência em uma requisição. | `src/app/api/messages/bulk/route.ts` | Médio | Feito |
| 3.9 | Checagem de origem (`hasValidSessionMutationOrigin`) espalhada rota a rota; aplicar em um ponto central. O cookie é `SameSite=Lax`, então é reforço. | `src/lib/auth/origin.ts` | Médio | Feito |

## Fase 4: instalação e ambiente

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 4.1 | `.env.docker.example` fora do git, embora o README mande copiá-lo. | `.gitignore` | Pequeno | Feito |
| 4.2 | `wrangler.jsonc.example` desatualizado: faltam o Durable Object `REALTIME`, sua migração e `DEVICE_LOGIN_RATE_LIMIT`. | `wrangler.jsonc.example` | Pequeno | Feito |
| 4.3 | Scripts npm com `VAR=valor comando` não rodam no Windows. Usar `cross-env`. | `package.json` | Pequeno | Feito (sem `cross-env`: `scripts/with-env.mjs`) |
| 4.4 | 17 variáveis de ambiente sem documentação, entre elas `TRUST_PROXY` (sem ela, atrás de proxy reverso todos dividem o mesmo limite de login), `APNS_*` e `SPAMHAUS_DQS_KEY`. | `docs/`, `.env.docker.example` | Pequeno | Feito |
| 4.5 | O teste `sns-signature` depende do binário `openssl`. | `tests/sns-signature.test.mjs` | Pequeno | Feito |
| 4.6 | Dependências vulneráveis: atualizar `smtp-server` e `wrangler`; planejar `mailauth` 8. | `package.json` | Médio | Feito (`npm audit` sem vulnerabilidades, inclusive de desenvolvimento, depois do 4.11) |
| 4.11 | Encontrado na segunda rodada: as 6 vulnerabilidades restantes (1 alta) estão no `vite-plus` 1.0.0 e somem a partir da 1.3.0. Mas com `vinext` 1.0.0-beta.13, o `vite-plus` 1.3.0, 1.4.0 e 1.6.0 geram um Worker quebrado: o `index.js` vira um reexport de 83 bytes e o chunk do ponto de entrada importa `./__vinext_cacheability_manifest.js` por caminho errado, então o Worker não sobe (o deploy falharia). Atualizar o `vinext` (há 1.4.x estável) e então o `vite-plus`, testando com `npm run preview`. As vulnerabilidades são do vitest em modo navegador/UI e do launch-editor, que o projeto não executa. | `package.json` | Médio | Feito (`vinext` 1.4.2, `vite-plus` 1.4.0, `@vitejs/plugin-rsc` 0.5.39; Worker sobe no `vp preview`, login, lista, cursor e iframe conferidos no Chrome; o erro `Identifier 'o' has already been declared` do beta.13 sumiu) |
| 4.7 | Migrações no MySQL não são atômicas e não há bloqueio contra execução simultânea. | `src/lib/migrations/service.ts` | Médio | Feito |
| 4.8 | Encontrado na segunda rodada: `package.json` (`cloudflare.bindings`) descreve `CF_EMAIL_WORKER_NAME`, mas nenhum código a lê; `getEmailWorkerName()` devolve `"mailclaw"` fixo. Remover a variável ou passar a lê-la. | `package.json`, `src/lib/cloudflare-api.ts` | Pequeno | Feito (`CF_EMAIL_WORKER_NAME`, padrão `mailclaw`) |
| 4.9 | Encontrado na segunda rodada: `requireUser` ficou sem nenhum chamador depois do item 3.3. Remover, ou manter para código de terceiros. | `src/lib/auth/cookies.ts` | Pequeno | Feito (removido) |
| 4.10 | Encontrado na segunda rodada: o `B2Bucket` devolve as chaves de `customMetadata` em minúsculas (comportamento do S3). Nada lê hoje uma chave em camelCase de volta, mas código novo pode cair nisso. | `src/lib/storage/b2-bucket.ts` | Pequeno | Feito (`x-amz-meta-mailclaw-key-case`; não testado em B2/S3 reais) |

## Fase 5: frontend e qualidade

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 5.1 | Sem telas de erro: nenhum `error.tsx`, `global-error.tsx` ou `not-found.tsx`. | `src/app` | Pequeno | Feito |
| 5.2 | Botão vazio no leitor quando o conteúdo remoto está liberado (sem texto nem nome acessível). | `src/components/messages/email-html-renderer.tsx` | Pequeno | Feito |
| 5.3 | 23 dos 38 `DialogContent` não têm altura máxima; os dois com mais campos são a troca de senha e a página de caixas de correio. | `src/components/settings/password-settings.tsx`, `src/app/(admin)/mailboxes/page.tsx` | Pequeno | Feito |
| 5.4 | Traduções: faltam 18 chaves em `id`, `ja`, `vi`, `zh-CN` e 4 em `ko`, `ms`, `th`; nove idiomas têm chaves sobrando. | `public/locales` | Pequeno | Feito (ver 5.8) |
| 5.5 | Desligar `ignoreBuildErrors` (o `tsc` já passa limpo) e zerar os 84 avisos de lint. | `next.config.ts` | Pequeno | Feito |
| 5.6 | Dividir `compose-form.tsx` (1.028 linhas). | `src/components/compose/compose-form.tsx` | Médio | Feito |
| 5.7 | Lacunas de teste: `drive`, `search`, `realtime`, `accounts`, `setup` e outros diretórios de `src/lib` sem testes; um único teste E2E, fora do CI. | `tests/` | Grande | Feito (≈185 testes novos em 14 arquivos; workflow E2E `e2e.yml` escrito, ainda não rodou no GitHub) |
| 5.8 | Encontrado na segunda rodada: cerca de 65 chaves continuam com o texto em inglês nos 33 catálogos (cerca de 2.000 textos), entre elas `attachment.risk.*`, `contacts.*`, `importJobs.*`, `setup.skipDns*` e `account.permissions.*`; o teste de paridade passa porque a chave existe. O `pt-PT` tem algumas frases em português do Brasil. | `public/locales` | Médio | Feito (≈96 chaves traduzidas nos 33 catálogos; pt-PT revisado; sem revisão nativa) |

## Fase 6: desempenho e infraestrutura Cloudflare

Terceira passada (16/11/2026). Tudo foi confirmado por leitura do código; onde há número, a origem está em "Medições". Nada foi medido em produção.

### Limites do plano gratuito que estes itens tocam

Documentação da Cloudflare consultada em 16/11/2026.

| Serviço | Limite no Workers Free | O que consome no Mailclaw |
|---|---|---|
| Workers | 100 mil requisições por dia; 10 ms de CPU por requisição HTTP e por execução de cron | Toda chamada de API e todo HTML. Arquivos estáticos não passam pelo Worker. |
| Subrequisições | 50 externas e 1.000 a serviços internos (D1, R2) por invocação | Webhooks, push, consultas de spam e chamadas a provedores. |
| D1, consultas | 50 consultas por invocação (um `db.batch` conta como uma); 500 MB por banco | Um e-mail recebido fazia 34 consultas na fila, e o lote de 5 somava 170. Depois da segunda rodada: 18 consultas, uma mensagem por invocação. |
| D1, linhas | 5 milhões de linhas lidas e 100 mil escritas por dia; ao estourar, as consultas passam a falhar até 00:00 UTC | Conta linha varrida, não linha devolvida. Cada índice gravado conta uma escrita a mais; `messages` tem 14 índices, mais os triggers de `message_counters`. |
| Queues | 10 mil operações por dia (3 por mensagem, mais 1 por retentativa); retenção fixa de 24 horas | As três filas somadas: cerca de 3.300 mensagens por dia entre e-mails recebidos, envios, webhooks e lotes de importação. |
| Durable Objects | 100 mil requisições e 13 mil GB-s por dia | Um objeto por usuário conectado; com hibernação, o custo é desprezível. |

### Medições

Locais, em Node 24 na máquina de desenvolvimento (script em pasta temporária, fora do repositório). Servem de ordem de grandeza, não de número do Workers.

| O que | Resultado |
|---|---|
| `drizzle(d1, { schema })`, uma chamada | 0,078 ms; sem o schema, 0,001 ms |
| `parseRawMime`, e-mail sem anexo | 0,4 ms |
| `parseRawMime`, anexo de 1 MB / 5 MB / 15 MB | 30 ms / 146 ms / 450 ms |
| `bcrypt.compareSync`, custo 12 | 747 ms |
| Checagem de duplicidade do e-mail recebido, caixa de 50 mil mensagens, SQLite 3.50 sem estatísticas / com `ANALYZE` | 25,7 ms (varre a caixa) / 0,02 ms |
| Linhas da página de conversas, mesma base, sem / com estatísticas | 8,2 ms / 0,2 ms |
| Contadores da barra lateral, mesma base | 10 ms, com ou sem estatísticas |

Depois da segunda rodada (mesmas condições, medidos pelos agentes que fizeram cada item):

| O que | Antes | Depois |
|---|---|---|
| Checagem de anexos no handler `email`, anexo de 1 MB / 18 MB | 17 ms / 499 ms (parse completo) | 0,6 ms / 7,5 ms (varredura linear) |
| Verificação de senha | 590–750 ms (bcryptjs custo 12) | 40–65 ms em Node, 57 ms em workerd local (scrypt N=2^14) |
| Consultas ao D1 por e-mail recebido, na fila / no handler | 34 / 8 | 18 / 5 |
| Primeira abertura da caixa de entrada | 12 requisições ao Worker em 5 etapas | 7 requisições em 3 etapas |
| Linhas da página de conversas, sem estatísticas | 18–20 ms | 0,3 ms |
| Página de Enviados / Favoritos, caixa de 48 mil mensagens (passos da VM do SQLite) | 102 mil / 346 mil | 1,2 mil / 1,2 mil |
| Contadores da barra lateral | GROUP BY sobre toda a caixa | dezenas de linhas de `message_counters` |
| Heartbeat do tempo real | consulta ao D1 a cada 25 s por navegador | respondido pelo runtime sem acordar o objeto |

Do log de build da Cloudflare de 16/11/2026: upload de 8.028 KiB (2.122 KiB com gzip), tempo de inicialização do Worker de 67 ms (limite de 1 s). Maiores arquivos do cliente: `rich-text-utils` 396 kB, `index` 308 kB, `framework` 219 kB, `use-assistant-availability` 193 kB, `language-provider` 131 kB.

### 6A. Worker, filas e entrada de e-mail

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 6.1 | O e-mail recebido é parseado por inteiro duas vezes: no handler `email`, só para checar o limite de anexos, e de novo na fila. O `CLAUDE.md` diz que o handler nunca parseia. O limite de bytes já está garantido pelo corte de 25 MiB em `rawSize` (anexo em base64 não passa de 19,7 MB decodificados). Trocar o parse do handler por `mimePreflightReason`, que é uma varredura linear, contando as partes na mesma passada; a fila continua barrando o resto. | `worker.ts:92`, `src/lib/email/inbound-attachments.ts:27`, `src/lib/email/inbound.ts:101` | Pequeno | Feito |
| 6.2 | As filas de entrada e de saída entregam lotes de 5, processados em sequência numa só invocação. As cinco mensagens dividem o mesmo orçamento de CPU e de memória, e uma que derrube a invocação faz as não confirmadas gastarem uma tentativa junto. Usar `max_batch_size: 1` na fila de entrada e medir. | `wrangler.jsonc:108`, `wrangler.jsonc:115`, `worker.ts:128` | Pequeno | Feito |
| 6.3 | A retentativa espera sempre 10 s e há 3 tentativas: uma indisponibilidade de 40 s do D1 ou do provedor já descarta a mensagem. Usar espera crescente a partir de `msg.attempts` e mais tentativas. Fazer junto com a dead-letter queue do item 2.1. | `worker.ts:151`, `wrangler.jsonc:111` | Pequeno | Feito |
| 6.4 | `getDb()` monta uma instância nova do Drizzle com o schema inteiro a cada chamada, e há 390 chamadas em 204 arquivos. O schema só serve à API relacional `db.query`, que o código não usa. Guardar a instância por binding num `WeakMap`. | `src/db/index.ts:7`, `src/db/index.ts:21` | Pequeno | Feito (só D1) |
| 6.5 | Senhas com `bcryptjs` custo 12, síncrono: cerca de 750 ms de CPU por verificação. A troca de senha faz duas verificações e um hash na mesma requisição. Migrar para `scrypt` nativo de `node:crypto`, com re-hash no próximo login, e medir no Workers. Resolve o risco anotado mais abaixo. | `src/lib/auth/password.ts:11`, `src/app/api/settings/password/route.ts:34` | Médio | Feito |
| 6.6 | Consultas que o processamento de um e-mail faz sem precisar: o encaminhamento da conta repete `resolveInboundAddress` feito 24 linhas antes; a resposta automática e o rascunho automático resolvem endereços e carregam a caixa antes de checar se o recurso está ligado; o contato é lido e depois atualizado, em vez de um upsert. Inverter as guardas e reaproveitar a decisão de roteamento. | `worker.ts:106`, `src/lib/email/account-forwarding.ts:47`, `src/lib/email/auto-reply.ts:21`, `src/lib/agent/jobs/utils.ts:31`, `src/lib/contacts/service.ts:16` | Pequeno | Feito |
| 6.7 | Anexos gravados um a um: um `put` no R2 e um `insert` por anexo, em sequência (até 20 idas e voltas). O mesmo ao carregar anexos para enviar. Gravar em paralelo, até 6 por vez, e inserir as linhas de uma vez. | `src/lib/email/attachments.ts:84`, `src/lib/email/attachments.ts:176` | Pequeno | Feito |
| 6.8 | Abrir uma mensagem sempre lê 64 KB do `.eml` no R2 para achar o cabeçalho `List-Unsubscribe`, embora a linha já tenha `has_unsubscribe`. Pular a leitura quando o campo é falso, ou gravar a URL na entrada (coluna nova nos três dialetos). | `src/lib/email/inbound.ts:353`, `src/lib/email/unsubscribe.ts:90` | Pequeno | Feito |
| 6.9 | O primeiro e-mail de cada remetente novo faz até duas chamadas ao Gravatar, sem timeout, e duas gravações no R2 antes de a mensagem ser salva. Buscar o avatar depois de salvar e notificar, com timeout (item 3.7). | `src/lib/contacts/service.ts:49`, `src/lib/contacts/gravatar.ts:27` | Pequeno | Feito |

### 6B. Configuração da Cloudflare

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 6.10 | Smart Placement desligado. Cada requisição faz várias consultas ao D1 em sequência, e o Worker roda perto do usuário, não do banco. Ligar `"placement": { "mode": "smart" }` (existe no plano gratuito, vale só para `fetch`) e comparar a latência antes e depois. | `wrangler.jsonc`, `wrangler.jsonc.example` | Pequeno | Feito |
| 6.11 | O código de réplicas de leitura do D1 está pronto (sessão por requisição e cookie `mf-d1-bm`), mas a replicação precisa ser ligada no banco, no painel ou pela API. Sem isso toda leitura vai ao primário. Não está na documentação e não foi conferido se está ligada em produção. | `worker-utils.ts:75`, `docs/deployment.md` | Pequeno | Feito (replicação de leitura ligada em 17/11/2026, `read_replication: auto`) |
| 6.12 | O deploy de 16/11/2026 publicou só o endereço `workers.dev`, onde a Cache API não funciona. Ligar um domínio próprio ao Worker libera cache na borda e regras de WAF e de limite de taxa, e permite desligar `workers_dev` (P3.7). | `wrangler.jsonc`, `docs/deployment.md` | Pequeno | Parcial (documentado; depende de domínio) |
| 6.13 | Prefixos do bucket que só crescem: `spam-cache/` (cache das consultas de spam), além de `relay-seen/` e `sns-seen/` do item 3.6. Resolver com regras de ciclo de vida do R2 por prefixo, sem código, e documentar o equivalente para B2 e S3. | `src/lib/spam/lookup-cache.ts:37`, `docs/deployment.md` | Pequeno | Feito (regras no `mailclaw-raw` em 17/11/2026: `spam-cache/` 30 dias, `sns-seen/` 7, `relay-seen/` 1) |
| 6.14 | O cron de 5 minutos roda cinco tarefas na mesma execução (seis com a correção 2.2), com 10 ms de CPU no plano gratuito. Retenção da lixeira não precisa rodar 288 vezes por dia: passar para o cron diário ou de hora em hora. | `worker.ts:159` | Pequeno | Feito |
| 6.15 | Documentar as cotas da tabela acima e o que cada uma permite. É a entrada para a decisão P2.4. | `README.md`, `docs/deployment.md` | Pequeno | Feito |

### 6C. D1: consultas e índices

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 6.16 | O banco nunca recebe `ANALYZE` nem `PRAGMA optimize`. Sem estatísticas, o SQLite escolhe um índice largo por `mailbox_id` em vez do seletivo, e três consultas varrem a caixa inteira: a checagem de duplicidade de todo e-mail recebido, as linhas de toda página de conversas e a retenção da lixeira. Numa caixa de 50 mil mensagens, 100 e-mails recebidos já leem os 5 milhões de linhas do dia. Rodar `PRAGMA optimize` no cron diário e depois das migrações; trocar a checagem de duplicidade para filtrar só por `raw_r2_key`. Conferir `sqlite_stat1` no console do D1 de produção. | `src/lib/email/inbound.ts:80`, `src/app/api/messages/route.ts:124`, `src/lib/email/trash-retention.ts:24`, `worker.ts:156` | Pequeno | Feito |
| 6.17 | Os contadores da barra lateral agrupam todas as mensagens da caixa, e o cliente descarta o cache a cada leitura, estrela ou e-mail novo. Estatísticas não resolvem. Manter uma tabela de contadores por trigger, como já se faz com `jmap_changes`, ou contar só as não lidas. | `src/app/api/messages/counts/route.ts:39`, `src/hooks/utils.ts:122` | Grande | Feito |
| 6.18 | Cada página da lista conta a pasta inteira (`count()` ou `countDistinct`) e pagina com `OFFSET`. Devolver `hasMore` pedindo uma linha a mais, tirar o total dos contadores e paginar por chave em `(created_at, id)`. | `src/app/api/messages/route.ts:146`, `src/app/api/messages/utils.ts:61` | Médio | Feito (cursor `k1:` com `nextCursor`; visão por conversa volta a OFFSET acima de 25 caixas, pelo limite de 100 parâmetros do D1) |
| 6.19 | Nenhum índice entrega Enviados, Arquivados, Spam e Lixeira já ordenados por data: a pasta inteira é lida e ordenada a cada página. Favoritos e a visão de todas as caixas têm o mesmo problema. Criar `(mailbox_id, status, created_at DESC, id DESC)` e `(mailbox_id, created_at DESC)` nos três dialetos. Na mesma migração, remover `messages_mailbox_idx`, que é prefixo de outros índices, e dar lista de colunas ao `select()` de `/api/v1/messages`, que hoje devolve os corpos. | `src/db/schema/index.ts:352`, `src/app/api/v1/messages/route.ts:55` | Médio | Feito, com ajuste (ver Andamento) |
| 6.20 | Exclusão definitiva faz pelo menos três consultas e uma remoção no R2 por mensagem, em lotes de 200 no cron e de 100 ao esvaziar a pasta. Buscar os anexos com um `IN`, remover do R2 em lista e apagar em blocos. Fazer junto com o item 3.8. | `src/lib/email/permanent-delete.ts:24` | Médio | Feito |
| 6.21 | O cron de lembretes do calendário lê os eventos passados de todos os usuários a cada 5 minutos, e o `LIMIT 500` não tem `ORDER BY`: com mais de 500 candidatos, parte dos eventos pode nunca ser olhada. Indexar por `starts_at`, limitar a faixa e ordenar. | `src/lib/calendar/reminders.ts:24` | Pequeno | Feito |
| 6.22 | Autenticação: a sessão faz duas leituras em sequência no primário (uma junção resolve); a chave de API manda um `UPDATE` de `lastUsedAt` em toda requisição, filtrado só no SQL (comparar em JavaScript antes); `/api/v1/messages` relê `users` que a autenticação já carregou. | `src/lib/auth/session.ts:46`, `src/lib/api/key-auth.ts:27`, `src/app/api/v1/messages/route.ts:26` | Pequeno | Feito (colunas da v1: ver 6.36) |

### 6D. Requisições do navegador

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 6.23 | Abrir a caixa de entrada custa cerca de 13 requisições ao Worker, em cinco passos encadeados (HTML, JavaScript, `/api/auth/me`, caixas, mensagens), porque o layout e a página são componentes de cliente e nada monta antes de `/api/auth/me` responder. Criar um endpoint de inicialização único ou resolver esses dados no layout do servidor, como o branding já faz. | `src/components/auth/auth-guard.tsx:24`, `src/components/mailbox-provider.tsx:66`, `src/components/messages/message-folder-page.tsx:398` | Médio | Feito |
| 6.24 | Quem não usa inglês paga o catálogo inteiro em todo HTML: o `pt-BR.json` de 155 KB é lido pelo binding de assets, parseado e reescrito dentro da página a cada renderização. O `en.json` de 138 KB vai embutido no JavaScript de todos. Deixar o navegador buscar `/locales/<idioma>.json` como arquivo estático com cache. | `src/app/layout.tsx:52`, `src/lib/i18n/server.ts:12`, `src/lib/i18n/utils.ts:1` | Médio | Feito |
| 6.25 | O painel do assistente consulta três endpoints a cada 30 s enquanto está aberto, mesmo com a aba oculta: 8.640 requisições por dia por aba, 8,6% da cota. O evento `agent_draft` já chega pelo WebSocket. Tirar o intervalo ou consultar só com a aba visível e job pendente. | `src/components/agent/agent-panel.tsx:177` | Pequeno | Feito |
| 6.26 | Não há divisão de código: nenhum `next/dynamic`, `lazy()` ou `import()` em componentes. O compositor (com DOMPurify, css-tree e parse5) e o painel do assistente (com react-markdown) entram no carregamento inicial do dashboard. Carregar os dois sob demanda. | `src/app/(dashboard)/layout.tsx:9`, `src/app/(dashboard)/layout.tsx:14` | Médio | Feito |
| 6.27 | O proxy de imagens remotas responde `private, no-store` e copia a imagem inteira na memória: uma newsletter com 30 imagens custa 30 requisições a cada abertura. Usar `private, max-age=86400`, que guarda só no navegador do próprio usuário. | `src/app/api/remote-images/route.ts:7`, `src/app/api/remote-images/route.ts:25` | Pequeno | Feito (streaming depois da checagem de assinatura) |
| 6.28 | Passar o mouse por uma linha da lista dispara na hora o prefetch da rota daquela mensagem, uma requisição por linha. A página de detalhe é componente de cliente, então a resposta é igual para qualquer mensagem. Fazer um prefetch por pasta. | `src/components/messages/message-navigation.tsx:24` | Pequeno | Feito |
| 6.29 | Rotas de arquivo sem revalidação: anexos com `max-age=300`, sem `ETag`, `If-None-Match` nem `Range`; a checagem de risco (`risk=1`) abre o objeto inteiro no R2 só para cancelar; o avatar busca o objeto completo antes de comparar o `ETag`; o favicon passa pelo Worker e pelo D1 mesmo sem ícone personalizado. Responder 304 a partir de `object.httpEtag` e usar `head` onde o corpo não é lido. | `src/app/api/messages/[messageId]/attachments/[attachmentId]/route.ts:27`, `src/lib/avatar-images.ts:43`, `src/app/layout.tsx:59` | Médio | Feito |
| 6.30 | Depois de enviar, o aviso consulta o status a cada 1 s até a entrega; com a janela de desfazer de 15 s são pelo menos 15 requisições por envio. Espaçar as consultas ou avisar pelo WebSocket. | `src/components/compose/floating-composer.tsx:15` | Pequeno | Feito |
| 6.34 | Encontrado na segunda rodada: a contagem da lista de Favoritos ainda varre a caixa inteira (cerca de 289 mil passos numa caixa de 60 mil mensagens). Servir de `message_counters`, que já tem a dimensão `starred`. | `src/app/api/messages/route.ts` | Pequeno | Feito (`count=only` lê `message_counters`) |
| 6.35 | Encontrado na segunda rodada: a página de Entrada na visão de todas as caixas ainda ordena com `TEMP B-TREE` (o planejador prefere `messages_counts_cover_idx`), e `Email/query` do JMAP sem filtro também ordena. | `src/app/api/messages/route.ts`, `src/lib/jmap/email-query.ts` | Médio | Feito em parte (Entrada de todas as caixas sem ordenação; `Email/query` do JMAP sem filtro continua ordenando: o índice que resolve piora a abertura de conversas sem estatísticas, como no 6.19. Página simples do JMAP passou a ler só até o fim da página) |
| 6.36 | `/api/v1/messages` devolve os corpos (`textBody`, `htmlBody`) em toda listagem. Não dá para cortar sem quebrar clientes: a resposta não está documentada e é o único jeito de ler corpos por chave de API. Decidir um opt-in, por exemplo `fields=summary`. | `src/app/api/v1/messages/route.ts` | Pequeno | Feito (`fields=summary`) |
| 6.37 | Encontrado na segunda rodada: a fila ainda resolve o roteamento de novo (3 consultas) para cada e-mail recebido; a decisão do handler poderia ir no payload. A notificação em tempo real faz mais 2. | `src/lib/email/inbound.ts`, `src/lib/realtime/utils.ts` | Pequeno | Feito (18 → 13 consultas; 16 sem a decisão no payload) |
| 6.33 | O heartbeat do tempo real manda a cada 25 s, com a aba visível ou não, um ping que acorda o Durable Object e roda no D1 a consulta de revisão de todas as caixas do usuário: 3.456 consultas por dia por navegador aberto, e o objeto quase não hiberna. Responder o keep-alive com `setWebSocketAutoResponse` (sem acordar o objeto) e consultar a revisão só ao voltar a aba ou reconectar. | `src/hooks/use-message-polling.ts:123`, `src/lib/realtime/hub.ts:43`, `src/lib/realtime/revision.ts:5` | Pequeno | Feito |
| 6.38 | Encontrado na verificação final: o HTML traz o `<link rel="preload">` de `/locales/<idioma>.json` duas vezes. O navegador baixa uma vez só, mas o layout deveria emitir um. | `src/app/layout.tsx` | Pequeno | Feito (`preload()` do react-dom) |
| 6.39 | Encontrado pelos testes da terceira rodada: um código TOTP podia ser usado de novo por cerca de 90 s (RFC 6238 §5.2). Registrar o último passo aceito com um `UPDATE` condicional. | `src/lib/auth/mfa.ts`, `src/lib/auth/totp.ts` | Médio | Feito (migração SQLite 0090, PostgreSQL/MySQL 0014; coluna fora do schema do Drizzle para o login não quebrar antes da migração) |
| 6.40 | Encontrados pelos testes da terceira rodada: o setup migrava um banco com tabelas alheias (a documentação dizia que recusava); o booking oferecia como livre um horário com convite não respondido e depois recusava a reserva; um backup restaurado ficava "em andamento" para sempre; a exportação mbox não escapava `From ` na primeira linha e o `>From` não fazia ida e volta; a transferência de conta movia uploads incompletos. | `src/lib/setup/migration.ts`, `src/lib/booking/create.ts`, `src/lib/backups/export.ts`, `src/lib/export/mbox.ts`, `src/lib/import/mbox.ts`, `src/lib/accounts/deletion.ts` | Pequeno | Feito (setup responde 409; mbox no formato mboxrd) |

### 6E. Runtime Node e Docker

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 6.31 | A fila em memória não limita a concorrência: uma rajada de N mensagens por SMTP roda N processamentos ao mesmo tempo, cada um com o MIME inteiro na memória. Pôr um limite pequeno de jobs simultâneos. | `server/runtime/queue.ts:37` | Pequeno | Feito |
| 6.32 | O bucket em disco percorre a árvore inteira de arquivos a cada página de `list` (a limpeza noturna pede até 20 páginas), guarda streams inteiros na memória no `put` e lê o arquivo todo para atender um trecho. O mapa do limitador de taxa e o cache de statements nunca descartam entradas. | `server/runtime/file-bucket.ts:208`, `server/runtime/misc.ts:6`, `server/runtime/sqlite-database.ts:42` | Médio | Feito |

## Riscos não confirmados

- No chat do assistente, ações de e-mail pedem aprovação, mas as de calendário valem na hora. Um e-mail malicioso lido pelo assistente poderia induzir mudanças na agenda. As ferramentas de calendário não foram lidas.
- As senhas passaram para scrypt (item 6.5): 40–65 ms de CPU por verificação, contra 750 ms antes. Ainda passa dos 10 ms do plano gratuito; nenhum hash de senha com força razoável cabe nesse limite. Falta ver no Workers se o login passa a responder sem o erro 1102.
- A página de limites das filas diz que o consumidor tem 30 s de CPU por padrão "nos dois planos"; a de Workers não traz número para o handler `email`. A segunda rodada tirou o parse do handler (item 6.1) e deixou uma mensagem por invocação (6.2). Confirmar em P2.1.
- O roteamento de entrada carrega todas as caixas do domínio, com todas as colunas, e filtra em JavaScript, até três vezes por e-mail (`src/lib/email/routing.ts`). O custo depende do número de caixas; não foi medido.
- Os planos de consulta da Fase 6 foram reproduzidos em SQLite 3.50 local com dados sintéticos. O D1 pode escolher diferente; conferir com `EXPLAIN QUERY PLAN` no console do D1.

## Conferido e correto

Login, redefinição de senha, chaves de API, validação de webhooks de entrada, proteção contra SSRF em imagens remotas e webhooks, cliente de tempo real, métodos de armazenamento usados pelo app, e `onDelete` em todas as 88 chaves estrangeiras.

Na passada de desempenho: `public/_headers` marca `/_next/static/*` como imutável e os arquivos estáticos não passam pelo Worker; não há middleware, e a CSP é montada uma vez; o tempo real usa a API de hibernação do Durable Object e um só WebSocket por navegador; `withDatabase` e `withStorage` guardam o resultado e os drivers de banco são importados sob demanda; a primeira página da caixa de entrada sai ordenada do índice e a lista não traz os corpos; a busca usa FTS5; a limpeza de MIME órfão usa o índice de `raw_r2_key`; o TanStack Query não refaz consultas ao focar a janela; no Docker, o SQLite roda em WAL com `busy_timeout` e a imagem é multi-stage, sem root e com healthcheck. O upload do Worker tem 8 MB e inicia em 67 ms, longe dos limites.

## Sem revisão

Restauração de backup, Drive, agendamento público, a maior parte da importação IMAP, a maior parte dos componentes de interface e qualquer teste em navegador.

Na passada de desempenho ficaram de fora: qualquer medição em produção (CPU, latência, linhas lidas no D1), os planos de consulta em PostgreSQL e MySQL, o caminho de envio, a importação e o JMAP além do básico.

## Andamento

Primeira rodada de correções (16/11/2026). Depois dela: `npx tsc --noEmit` sem erros, `npm run lint` com 0 erros, `node --test` com 679 passando, 5 pulados e 0 falhas.

- **2.2** `processOutboundQueue` carrega os anexos antes de reivindicar o job. `sweepStuckOutboundJobs` (cron de 5 minutos e agendador Node) resolve jobs parados em `sending` há mais de 15 minutos: vira `sent` se a mensagem já consta como enviada, senão `failed` com aviso de que a entrega foi interrompida. Não reenvia, para não duplicar.
- **2.3** `deliverEmail` só marca `failed` quando o provedor recusa. Tudo depois do aceite (status, notas, lembrete, webhooks, auditoria) é isolado e apenas registrado em log se falhar.
- **2.4** Na partida do servidor Node, `requeueScheduledOutboundJobs` rearma os envios agendados e os da janela de desfazer. Falta o equivalente para e-mails recebidos que estavam na fila.
- **3.1** Novo `clampIntParam` em `src/lib/http/pagination.ts`, usado em `messages`, `v1/messages`, `activity` e `audit-logs`. A rota `webhooks/[id]/deliveries` já tratava o caso. Mudança de comportamento: `limit=0` agora devolve 1 item em vez de nenhum.
- **3.2** `ping` não numérico no EventSource do JMAP cai no padrão de 30 segundos.
- **4.1** `.gitignore` libera `.env.docker.example`; o arquivo ainda precisa de `git add`.
- **4.2** `wrangler.jsonc.example` ganhou `durable_objects`, `migrations` e `DEVICE_LOGIN_RATE_LIMIT`.
- **4.5** Sem o binário `openssl`, os três casos assinados do teste `sns-signature` são pulados em vez de derrubar o arquivo; a validação de URL do certificado roda sempre.

Esses três comportamentos ganharam teste na segunda rodada (`tests/outbound-delivery.test.mjs`, 15 casos contra SQLite real; 9 deles falham com o `send.ts` anterior).

### Segunda rodada (16 e 17/11/2026)

Executada em paralelo por agentes, cada um dono de um conjunto de arquivos, com revisão e verificação final pelo coordenador. Resultado: `tsc` sem erros, lint 0/0, 904 de 906 testes passando (eram 682), build completo. São 317 arquivos alterados e 113 novos, entre eles 31 arquivos de teste.

**Mudanças que quem opera a instalação precisa saber**

- **Migrações novas:** SQLite `0088_list_indexes_reminders_mfa_attempts` e `0089_add_message_counters`; PostgreSQL e MySQL `0012` e `0013`. Aplicar em Admin, como as anteriores. Até lá o app funciona do jeito antigo (contadores, MFA e lembretes têm caminho de compatibilidade). A 0088 constrói dois índices em `messages` e pode demorar numa caixa grande. As SQLite 0088 e 0089 ficam fora de `meta/_journal.json` de propósito: o runner do Node aplicava primeiro o que está no journal, e as 0041–0051 não estão nele. O runner do Node agora aplica por ordem de nome, como o do Worker.
- **Filas:** lote de 1, 5 tentativas com espera crescente (10 s até 15 min) e duas dead-letter queues novas, `mailclaw-inbound-dlq` e `mailclaw-outbound-dlq`. A Cloudflare cria a fila de mensagens mortas se ela não existir, e o Wrangler não confere; por garantia, crie as duas antes do primeiro push (`npx wrangler queues create …`). O MIME bruto fica 30 dias antes da limpeza.
- **`wrangler.jsonc`:** `placement: smart`, `workers_dev: true` e `preview_urls: false`, explícitos.
- **Build:** `.nvmrc` (Node 24.22.1), `packageManager: npm@10.9.2` (o npm que gera e lê o lockfile, o mesmo do build da Cloudflare) e Dockerfile em Node 24. O lockfile passa em `npm ci` do npm 10.9.2.
- **Sessão:** o navegador deixa de guardar o token. Sessões abertas migram sozinhas no primeiro request, sem logout. O token só sai no JSON para clientes que não são navegador (scripts, app). Senhas novas e trocadas usam scrypt; as antigas são convertidas no próximo login. O MFA aceita 5 tentativas por desafio.
- **Requisições:** sem sessão, as rotas da API respondem 401 em vez de 500. POST, PUT, PATCH e DELETE com cookie vindos de outro site recebem 403, no Worker e no Node. Atrás de proxy HTTPS no Docker, é preciso `TRUST_PROXY=1`.
- **API:** `GET /api/messages` passou a devolver `hasMore`, `total` pode ser `null` e `?count=only` devolve só o total. Anexos respondem 304, 206 e 416. As rotas `bulk` e de evento do calendário respondem 400 ou 413 a corpos inválidos. `/api/v1/messages` não mudou (ver 6.36).
- **Envio pela Cloudflare no plano gratuito:** o setup conclui como "só recebimento" e avisa, em vez de travar.
- **Docker:** o SMTP responde por destinatário já no RCPT, e o e-mail recebido que estava na fila em memória é reprocessado ao reiniciar. As variáveis `RESEND_API_KEY`, `AWS_*`, `APNS_*`, `INBOUND_REQUIRE_SIGNED_HEADERS` e as de spam passam a chegar ao app.
- **Dependências:** `wrangler` 4.163, `smtp-server` 3.21, `mailauth` 8.1 (DMARC segue a RFC 9989; só afeta o SMTP próprio), `@cloudflare/vite-plugin` 1.69. `vite-plus` fica na 1.0.0 (item 4.11, resolvido na terceira rodada).

**Decisões tomadas no caminho, diferentes do texto original dos itens**

- 6.19: não foi criado `(mailbox_id, created_at DESC)`. Sem estatísticas, o SQLite passava a usá-lo para abrir uma conversa, que ia de 0,1 ms para 27 ms. Entraram `messages_status_page_idx` e `messages_starred_page_idx`; saíram `messages_mailbox_idx` e `messages_inbox_page_idx`, prefixos de outros índices. `messages_raw_r2_key_idx` passou a `(raw_r2_key, mailbox_id)`.
- 6.17: `messages_counts_cover_idx` foi mantido. A medição mostrou que a contagem de não lidas ficaria 5,5 vezes mais cara sem ele, e consultas do JMAP também o usam.
- 6.18: o total sai do caminho de cada página (`hasMore` com uma linha a mais, total pedido uma vez por visão), mas a paginação continua por `OFFSET`. A paginação por chave entrou na terceira rodada.
- 6.4: o cache da instância do Drizzle vale só para o D1. Bancos externos guardam a transação aberta na própria instância, e compartilhá-la entre requisições misturaria transações.
- 6.5: scrypt com N=2^14, o maior que o workerd aceita (2^15 falha por limite de memória). Custa 40–65 ms de CPU, ainda acima dos 10 ms do plano gratuito.
- 6.1: a checagem do handler virou uma varredura linear. Em alguns casos raros um e-mail que antes era devolvido ao remetente passa a ser descartado na fila em silêncio: anexo acima de 25 MB em codificação não base64 e estruturas MIME que a varredura conta a menos. O SMTP do Node continua com o parse completo, porque devolve 552 ao remetente.
- 1.2: só entrou `script-src-attr 'none'` na CSP. Isolar o HTML do e-mail num iframe com `sandbox` exige teste em navegador (imagens `cid:`, altura, atalhos) e ficou para depois. Feito na terceira rodada.
- 6.27: a imagem remota passa a ter cache de um dia no navegador, mas não é transmitida em streaming, porque o limite de 5 MiB e a checagem do tipo de arquivo precisam do corpo antes da resposta 200. Feito na terceira rodada.

**Correções fora do plano encontradas no caminho**

- A busca só com termos negados (`-fatura`) não devolvia nada no SQLite; no PostgreSQL e no MySQL, um termo negado escondia mensagens sem Cc ou sem texto. As duas foram corrigidas.
- O encaminhamento feito pelo SMTP do Node não levava o cabeçalho `X-Mailclaw-Forwarded`, que evita laço de encaminhamento.
- O cookie de sessão `Secure` era descartado pelo navegador no Docker em HTTP simples, e a sessão só funcionava graças ao token no `localStorage`.
- A migração 0088 quebrava em banco novo por causa da ordem do journal (ver acima).
- O lembrete do calendário podia nunca olhar parte dos eventos quando havia mais de 500 candidatos.
- Mensagens importadas com descadastro passam a ter o flag `has_unsubscribe` (chaves novas `imports/v2/` e `drafts/v2/`).

**O que depende de quem opera a conta**

P2.1 (filtrar `EXCEEDED_CPU` em Observability), ligar a replicação de leitura do D1 (6.11), domínio próprio (6.12), regras de ciclo de vida do R2 (6.13), proteger o branch `main` no GitHub exigindo o Checks (P3.1), criar as duas dead-letter queues e fazer o push (P1.1). Os passos estão em `docs/deployment.md`.

### Terceira rodada (17/11/2026)

Doze agentes em paralelo, mais a revisão do coordenador, que corrigiu à mão o que os testes novos acharam. Resultado: `tsc` sem erros, lint 0/0, 1.090 de 1.092 testes passando (eram 904), `npm audit` zerado, build completo com o `vinext` 1.4.2 e o Worker conferido no `vp preview` e no Chrome (login, lista, página por cursor, iframe com imagem `cid:`).

**Mudanças que quem opera a instalação precisa saber**

- **Migração nova:** SQLite `0090_add_totp_last_step`, PostgreSQL e MySQL `0014_totp_last_step`. Aplicar em Admin. Antes dela o login funciona como antes, só sem a proteção contra reuso do código TOTP. A coluna não está no schema do Drizzle de propósito (ver `CLAUDE.md`).
- **Leitura de e-mail:** o HTML de cada mensagem e de cada nota agora é um iframe `srcdoc` sem permissão de script. Links `mailto:`/`tel:` não abrem mais uma aba em branco.
- **API:** `GET /api/messages` aceita `cursor` e devolve `nextCursor`; a ordem entre mensagens do mesmo segundo ficou estável (`created_at`, `id`). `GET /api/v1/messages?fields=summary` devolve sem os corpos; outro valor de `fields` responde 400. O proxy de imagens remotas responde em streaming, sem `Content-Length`; uma imagem que passa de 5 MiB ou de 10 s depois da checagem chega cortada (no Docker, cada corte gera um "failed to pipe response" no log).
- **Setup:** `/api/setup/prepare` responde 409 a um banco com tabelas que o Mailclaw não criou e sem registro de migrações.
- **Configuração:** `CF_EMAIL_WORKER_NAME` passou a valer (padrão `mailclaw`). Quem renomear o Worker precisa saber que as regras de Email Routing criadas antes continuam apontando para o nome antigo.
- **CI:** novo workflow `e2e.yml` ("Browser tests"), ainda não executado no GitHub. Como o Update Mailclaw copia `.github/workflows` para as instalações, ele roda lá também, a menos que `SKIP_E2E` ou `SKIP_CHECKS` seja `true`.
- **Ferramentas:** `vinext` 1.4.2, `vite-plus` 1.4.0, `@vitejs/plugin-rsc` 0.5.39, todos com mais de duas semanas de publicação. O `index.js` do Worker continua com 83 bytes, mas agora reexporta um chunk com os caminhos certos.

**Encontrado e corrigido pelos testes novos (6.40):** setup em banco alheio, reserva recusada em horário oferecido como livre, backup restaurado preso em "em andamento", exportação mbox que dividia uma mensagem em duas, e transferência de conta que movia uploads incompletos.

**Ficou de fora, com motivo:** o índice que tiraria a ordenação do `Email/query` sem filtro (6.35) piora a abertura de conversas sem estatísticas; o nonce na CSP do app (1.2) precisa de middleware por requisição e ficou documentado em `docs/security.md`.

**Feito na conta em 17/11/2026:** filas `mailclaw-inbound-dlq` e `mailclaw-outbound-dlq` criadas; regras de ciclo de vida do R2 (6.13); replicação de leitura do D1 ligada (6.11); merge no `main` e push (P1.1). Falta aplicar as migrações 0088–0090 em Admin depois do deploy. Continuam com quem opera a conta: P2.1 e P2.2 (Observability e CPU em produção), domínio próprio (6.12) e proteção do branch `main` (P3.1, adiada).

### Nota sobre o item 2.1

A ideia de reprocessar órfãos pelo `raw-sweeper` não serve como está. O sweeper lista no máximo 2.000 objetos por execução, sempre a partir do início do prefixo `inbound/`. Em uma instalação com mais de 2.000 mensagens guardadas ele nunca chega aos objetos recentes: não apaga os órfãos novos, mas também não poderia reprocessá-los. A correção precisa de dead-letter queue no `wrangler.jsonc` (as filas têm de existir na conta) e de um cursor persistente no sweeper.