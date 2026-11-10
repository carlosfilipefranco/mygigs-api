# Listagens de concertos para análise

Os utilizadores podem enviar um ficheiro na janela «Adicionar concerto». São aceites CSV, TSV e TXT em UTF-8, XLS, XLSX, ODS e PDF, até 5 MB. Cada utilizador pode fazer até 10 pedidos de upload por hora, por processo da API.

O endpoint autenticado `POST /api/upload/concert-list` recebe JSON com `file: { name, content }` (conteúdo em base64) e uma `note` opcional, até 2000 caracteres. A autenticação e o limite de pedidos são aplicados antes de ler o corpo.

Cada upload cria uma sugestão `event` pendente na tabela `user_submission`, com `payload.submission_kind = concert_list`. Reutiliza o esquema existente, sem migração. O ficheiro é validado, guardado com nome aleatório em `public/uploads/.submissions` e removido se a criação da sugestão falhar. Esta pasta deve fazer parte do volume persistente dos uploads e das respectivas cópias de segurança. A rota pública de uploads bloqueia o acesso à pasta; o middleware estático também ignora pastas ocultas.

O admin consulta a listagem em Administração → Sugestões e listagens e descarrega-a através de `GET /api/submission/:id/file`, que exige sessão de administrador. Pode rejeitar o pedido ou marcá-lo como analisado. A análise e a criação dos concertos são manuais; marcar como analisado não importa o ficheiro. Os pedidos já analisados continuam disponíveis no filtro «Aprovadas / analisadas».

A lista de utilizadores está disponível na Administração da aplicação e em `/admin/users` no backoffice, com pesquisa por nome/email e páginas de 50 registos. O endpoint `GET /api/admin-tools/users` exige sessão de administrador e devolve apenas identificador, nome, email, perfil e data de registo.
