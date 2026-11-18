# Sugestões de concertos

O utilizador sem perfil de administrador encontra «Sugerir» nos concertos e escolhe entre enviar um ficheiro e preencher um formulário. O formulário pede apenas banda/artista, local (com cidade em texto livre) e data. Não pesquisa no setlist.fm, não carrega seletores do catálogo e não cria artistas, locais ou concertos.

## Formulário

`POST /api/submission` exige autenticação e recebe `entity_type: "event"` e `payload: { submission_kind: "concert", artist_name, venue_name, date }`. A data usa `YYYY-MM-DD`; artista e local são texto livre com até 200 e 300 caracteres. O servidor valida os três campos, ignora identificadores e outros campos enviados e guarda a sugestão como pendente. Os clientes anteriores que enviavam concertos com IDs devem ser atualizados em conjunto com a API.

## Ficheiros

`POST /api/upload/concert-list` recebe JSON com `file: { name, content }` (conteúdo em base64) e uma `note` opcional, até 2000 caracteres. Aceita CSV, TSV e TXT em UTF-8, XLS, XLSX, ODS e PDF, até 5 MB. Cada utilizador pode fazer até 10 pedidos de upload por hora, por processo da API. A autenticação e o limite de pedidos são aplicados antes de ler o corpo.

Cada upload cria uma sugestão `event` pendente na tabela `user_submission`, com `payload.submission_kind = concert_list`. O ficheiro é validado, guardado com nome aleatório em `public/uploads/.submissions` e removido se a criação da sugestão falhar. Esta pasta deve fazer parte do volume persistente dos uploads e das respetivas cópias de segurança. O acesso público à pasta é bloqueado.

O admin descarrega o ficheiro em Administração → Sugestões e listagens, através de `GET /api/submission/:id/file`. A leitura dos formatos é manual: o ficheiro não é analisado nem importado automaticamente. Na própria sugestão, o admin pode fazer várias pesquisas e acumular concertos selecionados, ou criar concertos manualmente. A decisão final é global por ficheiro e exige um comentário ao utilizador, incluindo eventuais exclusões.

## Revisão

`POST /api/event/setlistfm/search` e `/import` exigem perfil de administrador. Na revisão de uma sugestão, a pesquisa é preenchida com banda, local e data; os filtros podem ser corrigidos ou removidos. Os dados usados para importar um resultado são novamente obtidos diretamente do setlist.fm pelo servidor.

`POST /api/submission/:id/approve` recebe `setlistfm_ids` e/ou `event_ids`, além de `admin_note` (interna) e `user_message` (visível ao autor, até 1000 caracteres). O formulário individual requer exatamente um resultado ou evento; um ficheiro requer pelo menos um e permite até 100. Os eventos manuais são criados pelo admin antes de aprovar e validados novamente pela API. Reutilizam-se concertos já existentes.

A importação dos resultados selecionados, a decisão, os identificadores de revisão e a notificação são gravados numa transação. A linha da sugestão é bloqueada para impedir decisões concorrentes. Uma falha mantém a sugestão pendente e desfaz as importações dessa aprovação. A criação manual anterior é independente: o concerto já foi criado mesmo que o admin ainda não aprove a sugestão.

`POST /api/submission/:id/reject` recebe as notas e exige comentário para ficheiros. Também bloqueia a sugestão e grava decisão e notificação numa única transação. Pedidos já decididos devolvem 409.

## Notificação

Cada decisão cria uma notificação `submission_review` dirigida ao autor, com o resultado e a mensagem pública do admin. A nota interna não é incluída. A aprovação liga ao primeiro concerto; a rejeição liga à caixa de notificações. A notificação fica sempre na caixa da aplicação, independentemente dos interesses seguidos. O envio push é colocado na fila existente e respeita a preferência global de notificações e os dispositivos subscritos.

Não é necessária uma nova migração: reutilizam-se `user_submission`, `user_notification` e a fila de push existentes. É necessário publicar a aplicação e a API em conjunto. Não se devem executar decisões de demonstração contra dados reais para validar a interface.
