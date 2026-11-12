# Web Push para PWA e navegador

Esta implementação envia as notificações de novos concertos futuros e alterações
importantes a cada navegador/PWA que o utilizador activou explicitamente. Usa o
protocolo Web Push com VAPID e `web-push` 4, sem o projecto Firebase antigo da app.
A API requer Node.js 20 ou superior.

## Preparação e publicação

1. Aplicar `migrations/20261112_web_push.sql`, depois da migração de notificações.
2. Gerar um par de chaves uma única vez:
   `node scripts/generate-push-keys.js https://nagrade.pt`.
   O ficheiro `.secrets/web-push.json` fica privado e ignorado pelo Git.
   Não substituir chaves existentes: as subscrições dependem deste par estável.
3. No serviço da API, configurar `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`
   e `PUSH_VAPID_SUBJECT` com os valores do ficheiro, e `PUSH_WORKER_ENABLED=true`.
   Nunca copiar a chave privada para a app, logs ou Git. A chave pública é
   disponibilizada pelo endpoint autenticado de configuração.
4. Publicar a API e a app, nesta ordem. O build da app inclui `push-sw.js`.
   O Hosting serve este ficheiro com `Cache-Control: no-cache`.
5. Na app, abrir **Conta → Notificações → Push neste dispositivo** e escolher
   **Activar push neste dispositivo**. O pedido de permissão só ocorre neste
   clique. Não há envio para dispositivos que não tenham aceite.

No desenvolvimento local, a API também lê o ficheiro privado, mas o worker fica
desligado por omissão fora de `NODE_ENV=production`. Ligar manualmente com
`PUSH_WORKER_ENABLED=true` apenas quando se pretender enviar. A PWA local pode
usar a API de produção já publicada. O navegador requer HTTPS ou localhost.
No iPhone/iPad é necessário abrir a PWA instalada no ecrã principal; a interface
explica este requisito antes de pedir permissão.

## Entrega e preferências

A criação das notificações e a entrada na fila partilham a mesma transação do
catálogo. Só são enfileiradas subscrições existentes nesse momento: activar um
dispositivo não envia notificações antigas. A fila não efectua chamadas de rede
dentro de transações e pode ser processada por várias instâncias da API.

Antes de enviar, o worker verifica novamente o utilizador da subscrição, as
preferências gerais e o tipo da notificação. Notificações já lidas ou com mais
de 24 horas são canceladas. Erros temporários têm até seis tentativas com
intervalos crescentes. Endpoints expirados (404/410) são removidos. Os logs só
incluem identificadores internos e códigos de erro, sem endpoints ou chaves.

A entrega é pelo menos uma vez: se o processo parar depois de o fornecedor
aceitar a push e antes de confirmar na BD, pode repetir o envio. O `tag` estável
por notificação substitui a mesma notificação no dispositivo, com `renotify=false`.
O TTL no fornecedor é de 24 horas; depois de aceite não é possível revogar uma
push que o fornecedor ainda esteja a entregar. A entrega final depende do
navegador, do sistema operativo e das definições do dispositivo.

Cada conta pode ter até 20 subscrições. Um navegador é associado à conta que
activou a subscrição. Ao mudar de conta e activar novamente, a subscrição é
renovada; a API elimina tarefas da conta anterior em caso de reassociação.
Sair da conta remove a subscrição do navegador e tenta removê-la da API. Uma
sessão expirada remove-a localmente sem repetir pedidos autenticados inválidos.
Apagar a conta elimina subscrições e tarefas por chave estrangeira.

O worker dedicado tem âmbito `/push/`, independente do worker de cache da app.
Ao tocar numa push, abre o concerto/edição e marca a notificação como lida se
houver uma sessão válida. Uma push recebida com a app aberta actualiza também o
contador. Não há pedido automático de permissão ao iniciar sessão.

## Endpoints autenticados

- `GET /api/notifications/push/config`: `{ enabled, publicKey }`.
- `POST /api/notifications/push/subscriptions`: `{ subscription }`, com o JSON
  de `PushSubscription.toJSON()`; devolve `{ id }`.
- `DELETE /api/notifications/push/subscriptions/:id`: remove apenas uma
  subscrição do utilizador autenticado.

Só são aceites endpoints HTTPS de fornecedores conhecidos (Google, Mozilla,
Apple e Microsoft), para impedir pedidos a URLs arbitrários a partir do servidor.

Referências: [biblioteca Web Push](https://github.com/web-push-libs/web-push),
[Web Push na PWA iOS/iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
