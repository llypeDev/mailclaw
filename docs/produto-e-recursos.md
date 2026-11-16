# Mailclaw — o que é e o que vem incluso

Documento de referência do produto: o que ele faz, o que ele é tecnicamente e, principalmente, o
que está liberado em cada instalação. Todos os números foram medidos no repositório em
16/11/2026.

## 1. O produto

Alternativa self-hosted ao Google Workspace para domínio próprio:

- **E-mail**: caixas do domínio, pessoais ou compartilhadas, com permissões que você controla.
  Envio e recebimento por Cloudflare Email, Resend ou Amazon SES.
- **Regras de roteamento**: guardar, encaminhar, rejeitar ou classificar e-mail na entrada.
- **Calendário**: eventos com fuso, repetição e convites por e-mail.
- **Booking**: link público para alguém marcar um horário livre, com múltiplos anfitriões.
- **Drive**: arquivos e compartilhamento.
- **Agentes de IA**: buscar e-mail, redigir respostas, mexer na agenda; e um endpoint MCP para
  ferramentas externas.

Roda em dois lugares: **Cloudflare Workers** (D1, R2, Queues, Durable Object, Workers AI) ou um
**único container Docker** (SMTP na porta 25, SQLite, blobs em disco, fila em memória).

Licença: **MIT**. Sem conta, sem telemetria, sem serviço externo obrigatório.

### Stack

| Item | Valor |
|---|---|
| Código | ~85.900 linhas de TypeScript em 1.327 arquivos (`src`, `server`, `scripts`, `worker.ts`) |
| Testes | 119 arquivos, ~12.400 linhas, `node:test` |
| Rotas de API | 208 arquivos `route.ts` |
| Banco | Drizzle sobre SQLite/D1, PostgreSQL e MySQL, a partir de um schema só: 58 tabelas |
| Migrações | 88 no SQLite, 12 no PostgreSQL, 12 no MySQL |
| Frontend | Next.js 16 via vinext (Vite) + React 19, Tailwind v4, Radix, TanStack Query |
| Idiomas | 34, incluindo direita-para-esquerda |

## 2. Não existe recurso pago

Nada de chave de ativação, de verificação em servidor de licença, de limite de assentos ou de
tela de upgrade. O código não tem tabela de licença, rota de licença nem verificação de plano.

Uma versão anterior deste código tinha cinco permissões controladas por chave: branding, gestão de
contas, limite de assentos, encaminhamento por conta e caixas compartilhadas. Todas foram removidas
do código — o que sobrou é autorização normal de administrador.

| Recurso | Onde vive | O que decide o acesso |
|---|---|---|
| Nome, ícone e favicon próprios | Admin → Branding, `api/branding`, `app_settings` | só ser o administrador principal |
| Criar e gerenciar contas | `api/accounts`, `api/v1/accounts` | `requireAccountsAdmin` (admin) + `canManageUsers` |
| Número de contas | — | sem limite; não há contagem de assentos |
| Encaminhamento por conta | Configurações → Encaminhamento, `api/settings/forwarding` | o próprio usuário |
| Caixas compartilhadas | `api/mailboxes`, `mailbox_access` | dono da caixa, admin, ou quem recebeu acesso |
| Anfitriões múltiplos no booking | `api/booking` | qualquer admin |

`getMailboxSettingsAccess` (`src/lib/mailboxes/settings-access.ts`) deixa o administrador
principal configurar as caixas de qualquer conta, e um admin com permissão de gestão de usuários
configurar as de usuários comuns. Isso não dá acesso às mensagens nem à identidade de envio.

## 3. Como o e-mail anda

Entrada: Cloudflare Email Routing → R2 (MIME bruto) → fila → `processInboundMessage` →
decisão de roteamento (`deliver` / `reject` / `forward`) → `parseRawMime` → mensagem +
anexos → contatos → webhooks → aviso em tempo real pelo Durable Object.

Saída: `src/lib/email/send.ts` monta com `mimetext` e entrega pelo provedor do domínio de envio
(Cloudflare, Resend ou SES), com a linha em `outbound_jobs` acompanhando o job.

Fora dos Workers, o mesmo caminho existe em Node: SMTP com `smtp-server` + `mailauth`, fila em
memória, agendador próprio.

## 4. Verificação

No estado atual do repositório:

| Verificação | Resultado |
|---|---|
| `npx tsc --noEmit` | sem erros |
| `npm run lint` | 0 erros |
| `node --test tests/*.test.mjs` | 675 passam, 2 pulados de propósito, 1 falha só em máquina sem `openssl` |
| `npm run build` | build completo do Worker |

## 5. O que vem depois

O backlog de correções e melhorias, com arquivo e esforço de cada item, fica em
[plano-de-melhorias.md](plano-de-melhorias.md).
