# Recuperação de palavra-passe

O formulário de entrada tem uma ligação para `/recuperar-palavra-passe`. O email
abre `/redefinir-palavra-passe#token=...`, onde se define e confirma a nova
palavra-passe. Também permite definir uma palavra-passe em contas criadas com Google.

## Ativação

1. Criar uma conta em [Resend](https://resend.com) e validar o domínio de envio,
   configurando os registos DNS indicados pelo fornecedor.
2. Criar uma chave de API com permissão de envio para esse domínio e configurar
   apenas no servidor da API:

   ```dotenv
   RESEND_API_KEY=<chave de envio>
   EMAIL_FROM=Na Grade <noreply@nagrade.pt>
   PASSWORD_RESET_SITE_URL=https://nagrade.pt
   ```

   O remetente tem de pertencer ao domínio validado. Desativar o rastreio de links
   e aberturas no domínio de envio: os links contêm uma credencial temporária.
   A API usa diretamente o [endpoint de envio do Resend](https://resend.com/docs/api-reference/emails/send-email),
   sem dependências adicionais.
3. Antes de publicar a nova API, executar uma vez a migração
   `migrations/20261105_password_recovery.sql`, com uma conta autorizada a alterar
   o schema. Acrescenta `user.auth_version` e a tabela `user_password_reset`.
   A migração não é repetível; não voltar a executá-la depois de aplicada.
4. Publicar a API e o frontend. A API nova depende da migração, incluindo os
   endpoints de autenticação existentes.

Para desenvolvimento local, definir `PASSWORD_RESET_SITE_URL=http://localhost:8100`
ou o endereço local onde o frontend corre. HTTP apenas é aceite para localhost em
ambientes que não sejam produção. O endereço não é obtido de cabeçalhos do pedido.

## Comportamento

- `POST /api/user/forgot-password` recebe `{ "email": "..." }` e devolve a mesma
  mensagem para contas existentes e inexistentes. Emails inválidos recebem 400;
  configuração de envio em falta recebe 503, antes de consultar a conta.
- `POST /api/user/reset-password` recebe `{ "token": "...", "password": "..." }`.
  O token tem 32 bytes aleatórios, só o SHA-256 é guardado na BD e expira após
  30 minutos. Pedir outro link substitui o anterior. A mudança da palavra-passe e
  o consumo do token são feitos na mesma transação, impedindo reutilização.
- A nova palavra-passe exige pelo menos 8 caracteres, até 72 bytes em UTF-8
  (limite do bcrypt) e não pode começar pelo prefixo reservado `google-`.
- Uma redefinição incrementa `auth_version`. Os JWT e as sessões do backoffice
  anteriores deixam de ser aceites. Tokens antigos sem versão são tratados como
  versão zero e mantêm-se válidos até à primeira redefinição dessa conta.
- A recuperação não inicia sessão automaticamente. Após sucesso, a pessoa volta
  ao formulário de entrada; o frontend também elimina a sua sessão local.
- Há um intervalo mínimo de um minuto entre emails da mesma conta, controlado
  na BD. Por IP e por processo: 10 pedidos de recuperação e 30 tentativas de
  redefinição por 15 minutos. Em múltiplas réplicas, estes limites por IP devem
  passar para armazenamento partilhado. O proxy tem de fornecer o IP real do
  cliente de acordo com a configuração `trust proxy` existente.
- O token viaja no fragmento do URL e é retirado do endereço ao abrir o formulário.
  Não é guardado no armazenamento do browser. Recarregar a página exige reabrir
  o link do email. As páginas têm `noindex` e as respostas da API usam `no-store`.
- Falhas do fornecedor não revelam se a conta existe. São registadas sem email,
  token ou conteúdo do pedido; o token desse envio é removido para permitir nova
  tentativa. A aceitação pelo Resend não garante entrega na caixa de entrada;
  consultar o painel do fornecedor em caso de falhas de entrega ou limites.

Não foram enviados emails reais durante a implementação.
