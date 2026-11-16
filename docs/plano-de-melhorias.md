# Plano de melhorias do Mailclaw

Resultado de duas passadas de análise do repositório (novembro de 2026). Cada item traz o arquivo onde o problema foi confirmado. O estado de cada item fica na coluna "Estado" das tabelas; atualize ao concluir.

Verificações automáticas na data da análise: `npx tsc --noEmit` sem erros; `npm run lint` com 0 erros e 84 avisos; `node --test` com 675 de 678 testes passando (2 pulados de propósito, 1 falha por depender do binário `openssl`); `npm audit` com 30 vulnerabilidades (9 altas).

## Prioridades após a primeira instalação em produção (16/11/2026)

A primeira instalação real (Cloudflare, plano Workers Free, recebimento pela Cloudflare e envio pelo Resend) mostrou problemas que a leitura do código não tinha mostrado. Esta seção define a ordem de trabalho; os números entre parênteses remetem aos itens das fases abaixo.

### Etapa 1: publicar o que já está pronto

| # | Item | Estado |
|---|---|---|
| P1.1 | Fazer commit e push da primeira rodada de correções (2.2, 2.3, 3.1, 3.2, 4.1, 4.2, 4.5), que está só na cópia local; a produção roda sem elas. | Pendente |
| P1.2 | Rodar `tsc`, lint e a suíte antes do push. `sweepStuckOutboundJobs`, `requeueScheduledOutboundJobs` e a nova ordem em `deliverEmail` não têm teste próprio. | Pendente |

### Etapa 2: decidir se o plano gratuito aguenta

Suspeita, ainda sem medição. O plano Workers Free limita cada requisição a 10 ms de CPU.

| # | Item | Onde | Estado |
|---|---|---|---|
| P2.1 | Confirmar a causa do erro 1102 visto em `/inbox`: filtrar `EXCEEDED_CPU` em Observability, nas requisições e nas execuções da fila. | Painel da Cloudflare | Pendente |
| P2.2 | Medir o tempo de CPU do login (bcrypt custo 12 síncrono), de `/inbox` e do processamento de um e-mail recebido com anexo. | `src/lib/auth/password.ts`, `src/lib/email/inbound.ts` | Pendente |
| P2.3 | Tratar o item 2.1 como prioridade máxima: um estouro de CPU no consumidor da fila, somado à falta de dead-letter queue, perde o e-mail recebido em silêncio após 3 tentativas. | `wrangler.jsonc`, `src/lib/email/raw-sweeper.ts` | Pendente |
| P2.4 | Com os números, decidir: se a fila estoura, o Workers Paid é requisito para uso real e a documentação deve dizer isso. | `README.md`, `docs/deployment.md` | Pendente |

### Etapa 3: consertar o que quebrou na instalação

| # | Problema encontrado | Correção | Onde | Estado |
|---|---|---|---|---|
| P3.1 | `npm ci` falhou no build da Cloudflare (npm 10 rejeitou o lockfile gerado com npm 11). Contornado com `@types/node` 24. | Fixar a mesma versão de Node no CI (hoje 22) e no build da Cloudflare (24), e descobrir por que o CI, que roda `npm ci` com npm 10, não barrou o lockfile. | `.github/workflows/checks.yml`, `package.json` | Pendente |
| P3.2 | O deploy falhou porque o bucket R2 não existia; o Wrangler só o cria quando o R2 já está ativado na conta. | Documentar a ativação do R2 como pré-requisito do primeiro deploy. | `README.md`, `docs/deployment.md` | Pendente |
| P3.3 | Habilitar o envio pela Cloudflare no plano gratuito devolve 401 (código 2036) com uma dica sobre registros MX. | Incluir na dica a causa mais comum: o envio pela Cloudflare exige Workers Paid. | `src/lib/cloudflare-api-utils.ts` | Pendente |
| P3.4 | Esse 401 bloqueia a criação da conta no setup. | Quando o envio falhar por autorização, concluir como "só recebimento" e avisar. | `src/lib/domains/provision.ts`, `src/app/(auth)/register/register-client.tsx` | Pendente |
| P3.5 | Confusão entre o token de build, criado automaticamente pela Cloudflare, e o `CF_TOKEN` de execução. | Explicar que são dois tokens e atualizar o passo a passo para a tela nova de criação (políticas de conta e de zona). | `docs/deployment.md` | Pendente |
| P3.6 | O README promete receber e enviar de graça sem citar os limites. | Dizer o que o Workers Free cobre: envio só via Resend ou SES, e limite de CPU. | `README.md` | Pendente |
| P3.7 | O deploy avisa que `workers_dev` e `preview_urls` ficam ligados por padrão; as URLs de preview são públicas. | Definir os dois explicitamente. | `wrangler.jsonc`, `wrangler.jsonc.example` | Pendente |

### Etapa 4: segurança e dependências

Na ordem: 1.3 (tentativas de MFA), 1.1 (token de sessão no `localStorage`), 4.6 (dependências vulneráveis; o Wrangler está na 4.142 e existe a 4.163) e 3.7 (timeout nas chamadas externas, mais relevante agora que o envio depende do Resend). As fases 3 e 5 ficam para depois.

### Não verificado nesta rodada

Testes, lint e `tsc` não foram executados de novo; o resultado do CI no GitHub não foi consultado; nenhum tempo de CPU foi medido.

## Fase 1: segurança da sessão

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 1.1 | O token de sessão é devolvido no JSON do login e gravado em `localStorage`, o que anula o cookie `httpOnly`: qualquer XSS rouba uma sessão de 30 dias. Usar só o cookie no navegador; manter o token no corpo apenas para o app móvel. O cliente usa o token também como marcador de "qual conta está ativa" (troca de conta, invalidação de cache), então é preciso um marcador não secreto no lugar. | `src/lib/auth/client.ts`, `src/lib/auth/login-response.ts` | Médio | Pendente |
| 1.2 | O HTML dos e-mails é exibido na mesma origem do app (Shadow DOM + DOMPurify) e a CSP permite `'unsafe-inline'` em scripts. Trocar por CSP com nonce ou iframe com `sandbox`. | `src/components/messages/email-html-renderer.tsx`, `src/lib/security/headers.ts` | Grande | Pendente |
| 1.3 | O código MFA de 6 dígitos pode ser tentado várias vezes no mesmo desafio de 5 minutos, limitado só por IP. Adicionar contador de tentativas ao desafio (exige migração nos três dialetos). | `src/app/api/auth/mfa/verify/route.ts`, `src/lib/auth/login-challenge.ts` | Pequeno | Pendente |

## Fase 2: confiabilidade do e-mail

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 2.1 | E-mail recebido perdido em silêncio: sem dead-letter queue, após 3 tentativas a mensagem some da fila e o original é apagado em 24 horas. | `wrangler.jsonc`, `src/lib/email/raw-sweeper.ts` | Médio | Pendente (ver nota) |
| 2.2 | Envio agendado travado: o job vira `sending` antes de carregar os anexos e nada o devolve à fila. | `src/lib/email/send.ts` | Pequeno | Feito |
| 2.3 | Mensagem enviada marcada como "falhou": um erro em webhook ou log de auditoria depois do envio cai no `catch` que marca `failed`. | `src/lib/email/send.ts` | Pequeno | Feito |
| 2.4 | Fila em memória no Docker: reiniciar perde envios agendados e e-mails pendentes; nada é recuperado na partida. | `server/runtime/queue.ts`, `server/index.ts` | Médio | Parcial (saída feita; entrada pendente) |
| 2.5 | SMTP com vários destinatários: a rejeição de um devolve 550 para a mensagem inteira, mesmo já entregue aos outros; uma falha temporária em um refaz os encaminhamentos dos demais. | `server/runtime/smtp.ts` | Médio | Pendente |
| 2.6 | Encaminhamento da conta acontece antes de gravar o original; uma falha na gravação duplica o encaminhamento. | `worker.ts`, `src/lib/email/intake.ts` | Pequeno | Pendente |
| 2.7 | O salvamento automático de rascunho ignora respostas de erro e não avisa o usuário. | `src/components/compose/compose-form.tsx` | Pequeno | Pendente |
| 2.8 | Webhooks são entregues dentro do processamento (até 10 s cada, em sequência). Enfileirar a primeira tentativa. | `src/lib/email/webhooks.ts` | Médio | Pendente |

## Fase 3: defeitos pontuais da API

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 3.1 | `limit` negativo ou inválido: `Math.min(Number(limit), 100)` aceita `-1` e `NaN` em cinco rotas. No SQLite, `LIMIT -1` significa sem limite. | `src/app/api/messages/route.ts`, `v1/messages`, `activity`, `audit-logs`, `webhooks/[id]/deliveries` | Pequeno | Feito |
| 3.2 | Laço sem pausa no JMAP: `ping=abc` vira `NaN` e o servidor consulta o banco em sequência. | `src/lib/jmap/handler.ts` | Pequeno | Feito |
| 3.3 | Rotas que respondem 500 em vez de 401: `requireUser` aparece 72 vezes em 41 arquivos. Migrar para `requireSessionUser`. | `src/app/api/**` | Médio | Pendente |
| 3.4 | Corpo de requisição sem validação (cast direto do JSON; JSON malformado vira 500). | `src/app/api/messages/bulk/route.ts`, `src/app/api/calendar/events/[eventId]/route.ts` e outras | Médio | Pendente |
| 3.5 | Upload JMAP lê o corpo inteiro antes de checar o limite de tamanho. | `src/lib/jmap/handler.ts` | Pequeno | Pendente |
| 3.6 | Marcadores `relay-seen/` e `sns-seen/` nunca são apagados do armazenamento. | `src/app/api/inbound/route.ts`, `src/app/api/inbound/ses/route.ts` | Pequeno | Pendente |
| 3.7 | Chamadas externas sem timeout (Cloudflare, AWS, Resend, push). | `src/lib/cloudflare-api.ts`, `src/lib/aws/client.ts`, `src/lib/email/resend-api.ts`, `src/lib/email/outbound-provider.ts` | Pequeno | Pendente |
| 3.8 | Ação em massa `spam` processa até 5.000 mensagens em sequência em uma requisição. | `src/app/api/messages/bulk/route.ts` | Médio | Pendente |
| 3.9 | Checagem de origem (`hasValidSessionMutationOrigin`) espalhada rota a rota; aplicar em um ponto central. O cookie é `SameSite=Lax`, então é reforço. | `src/lib/auth/origin.ts` | Médio | Pendente |

## Fase 4: instalação e ambiente

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 4.1 | `.env.docker.example` fora do git, embora o README mande copiá-lo. | `.gitignore` | Pequeno | Feito (falta `git add`) |
| 4.2 | `wrangler.jsonc.example` desatualizado: faltam o Durable Object `REALTIME`, sua migração e `DEVICE_LOGIN_RATE_LIMIT`. | `wrangler.jsonc.example` | Pequeno | Feito |
| 4.3 | Scripts npm com `VAR=valor comando` não rodam no Windows. Usar `cross-env`. | `package.json` | Pequeno | Pendente |
| 4.4 | 17 variáveis de ambiente sem documentação, entre elas `TRUST_PROXY` (sem ela, atrás de proxy reverso todos dividem o mesmo limite de login), `APNS_*` e `SPAMHAUS_DQS_KEY`. | `docs/`, `.env.docker.example` | Pequeno | Pendente |
| 4.5 | O teste `sns-signature` depende do binário `openssl`. | `tests/sns-signature.test.mjs` | Pequeno | Feito |
| 4.6 | Dependências vulneráveis: atualizar `smtp-server` e `wrangler`; planejar `mailauth` 8. | `package.json` | Médio | Pendente |
| 4.7 | Migrações no MySQL não são atômicas e não há bloqueio contra execução simultânea. | `src/lib/migrations/service.ts` | Médio | Pendente |

## Fase 5: frontend e qualidade

| # | Item | Onde | Esforço | Estado |
|---|---|---|---|---|
| 5.1 | Sem telas de erro: nenhum `error.tsx`, `global-error.tsx` ou `not-found.tsx`. | `src/app` | Pequeno | Pendente |
| 5.2 | Botão vazio no leitor quando o conteúdo remoto está liberado (sem texto nem nome acessível). | `src/components/messages/email-html-renderer.tsx` | Pequeno | Pendente |
| 5.3 | 23 dos 38 `DialogContent` não têm altura máxima; os dois com mais campos são a troca de senha e a página de caixas de correio. | `src/components/settings/password-settings.tsx`, `src/app/(admin)/mailboxes/page.tsx` | Pequeno | Pendente |
| 5.4 | Traduções: faltam 18 chaves em `id`, `ja`, `vi`, `zh-CN` e 4 em `ko`, `ms`, `th`; nove idiomas têm chaves sobrando. | `public/locales` | Pequeno | Pendente |
| 5.5 | Desligar `ignoreBuildErrors` (o `tsc` já passa limpo) e zerar os 84 avisos de lint. | `next.config.ts` | Pequeno | Pendente |
| 5.6 | Dividir `compose-form.tsx` (1.028 linhas). | `src/components/compose/compose-form.tsx` | Médio | Pendente |
| 5.7 | Lacunas de teste: `drive`, `search`, `realtime`, `accounts`, `setup` e outros diretórios de `src/lib` sem testes; um único teste E2E, fora do CI. | `tests/` | Grande | Pendente |

## Riscos não confirmados

- No chat do assistente, ações de e-mail pedem aprovação, mas as de calendário valem na hora. Um e-mail malicioso lido pelo assistente poderia induzir mudanças na agenda. As ferramentas de calendário não foram lidas.
- As senhas usam bcrypt custo 12 de forma síncrona. Pode estourar o limite de CPU do plano gratuito do Workers; não foi medido.

## Conferido e correto

Login, redefinição de senha, chaves de API, validação de webhooks de entrada, proteção contra SSRF em imagens remotas e webhooks, cliente de tempo real, métodos de armazenamento usados pelo app, e `onDelete` em todas as 88 chaves estrangeiras.

## Sem revisão

Índices e desempenho das consultas, restauração de backup, Drive, agendamento público, a maior parte da importação IMAP, a maior parte dos componentes de interface e qualquer teste em navegador.

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

Sem teste automatizado: `sweepStuckOutboundJobs`, `requeueScheduledOutboundJobs` e a nova ordem em `deliverEmail` foram conferidos só pelo type check e pela suíte existente.

### Nota sobre o item 2.1

A ideia de reprocessar órfãos pelo `raw-sweeper` não serve como está. O sweeper lista no máximo 2.000 objetos por execução, sempre a partir do início do prefixo `inbound/`. Em uma instalação com mais de 2.000 mensagens guardadas ele nunca chega aos objetos recentes: não apaga os órfãos novos, mas também não poderia reprocessá-los. A correção precisa de dead-letter queue no `wrangler.jsonc` (as filas têm de existir na conta) e de um cursor persistente no sweeper.