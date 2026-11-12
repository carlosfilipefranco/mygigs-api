# Notificações na aplicação

Aplicar `migrations/20261112_notifications.sql` antes de publicar a API e, depois,
publicar a app. A migração é aditiva e repetível. Não gera notificações para o
catálogo existente nem migra favoritos ou presenças para interesses seguidos.
As tabelas de preferências, interesses e notificações têm eliminação em cascata
quando a conta é apagada.

Esta versão inclui novos concertos futuros e alterações de data, local, cidade,
artista, horário ou palco. Uma mudança de datas ou local de uma edição também
gera uma notificação. Concertos sem dia definido usam o fim da edição para
determinar se ainda são futuros, de acordo com o restante catálogo.

A criação das notificações é feita na mesma transação da alteração do catálogo.
São abrangidas as gravações de concertos, eventos, programas de festivais,
edições e as importações do setlist.fm. Regravar os mesmos valores não notifica.
Cada ocorrência é entregue uma única vez por utilizador mesmo quando vários
interesses coincidem. A entrega considera as preferências e os interesses no
momento da gravação, incluindo o local e a cidade anteriores numa mudança.
Operações SQL diretas fora destes serviços não geram notificações.

Tipos de interesse: `artist`, `festival`, `edition`, `venue`, `city` e `gig`.
O limite é de 500 interesses por utilizador. As opções globais são `enabled`,
`new_concerts` e `gig_changes`; todas ficam ativas por omissão, mas só há entrega
depois de seguir pelo menos um interesse. Desativar mantém o histórico e os
interesses; reativar não recupera novidades ocorridas durante a pausa.

O convite inicial é mostrado aos utilizadores que ainda não têm
`onboarding_completed`. Tanto «Agora não» como a conclusão da configuração
guardam esta escolha na conta. Utilizadores já existentes recebem o convite na
primeira sessão após a disponibilização da funcionalidade. As push são opcionais por dispositivo; a configuração e a entrega estão em
`docs/web-push.md`. Não há envio por email.

## API autenticada

Todos os endpoints estão sob `/api/notifications`, usam o utilizador do token
e devolvem `Cache-Control: no-store`.

- `GET /settings`: `{ preferences, follows }`, incluindo nomes e ligações.
- `PUT /settings`: atualização parcial com valores booleanos; inclui
  `onboarding_completed`. Campos desconhecidos são rejeitados.
- `GET /interests?type=artist&search=...`: até 20 interesses para seleção.
  Concertos individuais são pesquisados pelo artista e limitados aos futuros.
- `PUT /follows/:type/:id`: seguir, de forma idempotente.
- `DELETE /follows/:type/:id`: deixar de seguir.
- `GET /`: `{ data, hasMore, unread }`, até 30 notificações por página.
  `before=<id>` pagina por cursor, em ordem decrescente.
- `GET /unread`: `{ unread }`.
- `PUT /:id/read`: marcar como lida uma notificação do próprio utilizador.
- `PUT /read-all`: `{ through: <id mais recente carregado> }`; evita marcar
  notificações recebidas depois de atualizar a caixa.

O contador é atualizado enquanto a app está visível, uma vez por minuto, ao
regressar à janela e ao ler notificações. A caixa pode ser atualizada manualmente.
