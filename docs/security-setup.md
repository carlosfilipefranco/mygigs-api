# Configuração de segurança

Por indicação do utilizador, o servidor mantém temporariamente as chaves e a
ligação MySQL anteriores em `services/legacyConfig.js`. As variáveis de ambiente
têm precedência: cada chave pode ser substituída individualmente, sem obrigar à
rotação das restantes. A conta MySQL anterior continua aceite, incluindo em produção.

Os valores novos de `JWT_SECRET` e `ADMIN_SESSION_SECRET` devem ser diferentes,
aleatórios e ter pelo menos 32 bytes. Os valores antigos mantêm temporariamente
as fragilidades já identificadas. O ficheiro local `.env.security` contém segredos
novos preparados para uma rotação futura; carregá-lo substitui os valores anteriores.

## Preparar a rotação gradual

1. Executar `node scripts/generate-security-env.js`. Cria `.env.security`, com
   permissões 0600, sem imprimir segredos nem substituir um ficheiro existente.
2. Criar um utilizador MySQL dedicado. O script
   `node scripts/create-app-db-user.js` usa uma variável `DB_ADMIN_URL` explícita,
   cria `mygigs_app` com password aleatória e apenas `SELECT`, `INSERT`, `UPDATE`,
   `DELETE` na BD indicada. Guarda os dados em `.env.database` (0600).
   Não altera a conta administrativa. Usar outra conta para executar migrações.
3. Renovar a chave ImgBB na conta do fornecedor e configurar `IMGBB_API_KEY` apenas
   na API. A chave antiga continua exposta nos bundles já publicados até ser
   revogada no fornecedor. Configurar também `SETLISTFM_API_KEY` apenas no servidor.
4. No Railway, configurar `NODE_ENV=production`, os dois segredos novos, as
   variáveis `DB_*` de `.env.database` e as chaves dos serviços. A aplicação também
   aceita as variáveis `MYSQL*` ou `DATABASE_URL`/`MYSQL_URL`; `DB_*` têm precedência.

Os ficheiros `.env.*` estão ignorados pelo Git, exceto `.env.example`.
Para testar localmente com Node 22, pode usar-se:

```sh
node --env-file=.env.security --env-file=.env.database --env-file=.env index.js
```

Este comando aplica as credenciais novas. Para continuar com os valores anteriores,
usar apenas `npm start`, sem carregar os ficheiros da rotação. O último ficheiro
deve conter apenas a configuração adicional, como as chaves dos serviços.

## Ativar sem perder acesso

Configurar cada variável no Railway quando se pretender mudar essa credencial.
Enquanto uma variável não for configurada, mantém-se o respetivo valor anterior.
Quando todas as credenciais tiverem sido substituídas, remover `services/legacyConfig.js`
e tornar as variáveis obrigatórias. A nova chave JWT
invalida os tokens anteriores e obriga a iniciar sessão novamente. A nova chave
do backoffice invalida os cookies anteriores. Confirmar o acesso com o utilizador
limitado e só depois renovar a password administrativa MySQL que estava no código,
atualizando também qualquer outro serviço que a use. Remover um segredo do código
não o remove dos commits anteriores: é indispensável renovar as credenciais.

## Alterações funcionais

- `GET /api/setlist?gigId=...` apenas lê a BD. Não faz pedidos externos nem grava.
- `POST /api/setlist/fetch` exige autenticação e aceita apenas `gigId`. A API obtém
  artista, cidade, local e data na BD e verifica a correspondência com a fonte.
- `POST /api/upload/image` exige autenticação e conta existente, valida assinatura
  de formato raster e limita cada imagem a 10 MB. Há um limite de 60 pedidos/hora
  por utilizador e de quatro uploads simultâneos por processo. Para múltiplas
  réplicas, estes limites deverão passar para armazenamento partilhado.
- A interface já não contém a chave ImgBB e usa o endpoint autenticado da API.
- As contas Google novas recebem uma password interna aleatória. O login com o
  prefixo reservado `google-` é recusado para bloquear o esquema antigo; após um
  login Google válido, o hash antigo é substituído. Passwords próprias de contas
  locais que também usam Google são preservadas, exceto esse prefixo reservado.
- O backoffice exige `role=admin`, regenera a sessão após login e confirma na BD
  que o utilizador ainda é administrador a cada acesso protegido.

Estas alterações não acrescentam revogação individual de JWT nem os restantes
controlos de produção que não foram pedidos nesta tarefa.
