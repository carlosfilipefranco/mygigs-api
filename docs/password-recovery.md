# Recuperação de palavra-passe

O formulário de entrada tem uma ligação para `/recuperar-palavra-passe`.
A pessoa indica o email e permanece na mesma página: aparecem o campo do código
recebido e os campos da nova palavra-passe. O email contém um código de seis
algarismos, o logótipo do Na Grade e instruções para voltar ao formulário.
Não contém links de recuperação. Contas criadas com Google também podem definir
uma palavra-passe própria através deste fluxo.

## Ativação

1. Criar uma conta em [Resend](https://resend.com) e validar o domínio de envio,
   configurando os registos DNS indicados pelo fornecedor.
2. Criar uma chave de API com permissão de envio para esse domínio e configurar
   apenas no servidor da API:

   ```dotenv
   RESEND_API_KEY=<chave de envio>
   EMAIL_FROM=Na Grade <noreply@nagrade.pt>
   ```

   O remetente tem de pertencer ao domínio validado. A API usa diretamente o
   [endpoint de envio do Resend](https://resend.com/docs/api-reference/emails/send-email),
   sem dependências adicionais. `PASSWORD_RESET_SITE_URL` deixou de ser necessária.
3. Antes de publicar a API, aplicar, por esta ordem, as migrações ainda não
   executadas, com uma conta autorizada a alterar o schema:

   - `migrations/20261105_password_recovery.sql`: acrescenta `user.auth_version`
     e a tabela `user_password_reset`.
   - `migrations/20261105_password_recovery_codes.sql`: acrescenta a contagem de
     tentativas e os limites de envio por conta. É aditiva e pode ser aplicada
     enquanto a versão anterior da API está em funcionamento.

   As migrações não são repetíveis. Se a primeira já foi aplicada, executar
   apenas a segunda.
4. Publicar a API e o frontend em conjunto, pois o corpo do endpoint de
   redefinição passa de `{ token, password }` para `{ email, code, password }`.
   O frontend redireciona `/redefinir-palavra-passe` para o formulário de códigos.
   Os links de recuperação da versão anterior deixam de ser aceites pela API nova.

## Comportamento

- `POST /api/user/forgot-password` recebe `{ "email": "..." }` e devolve a mesma
  mensagem para contas existentes, inexistentes ou sujeitas ao intervalo de
  envio. Emails inválidos recebem 400; configuração de envio em falta recebe 503
  antes de consultar a conta.
- O código tem seis algarismos, incluindo eventuais zeros iniciais, e é gerado
  com `crypto.randomInt`. Expira ao fim de 10 minutos. Pedir outro código
  substitui o anterior. Só se guarda o HMAC-SHA-256 do código, associado ao
  utilizador e protegido com `JWT_SECRET`, na coluna `token_hash` existente.
  A rotação deste segredo também invalida os códigos pendentes.
- `POST /api/user/reset-password` recebe `{ "email": "...", "code": "012345",
  "password": "..." }`. O código deve ser uma string de seis algarismos.
  A comparação usa `timingSafeEqual`. Há um máximo de cinco tentativas erradas
  por código, guardado na BD e partilhado entre réplicas. O incremento é
  confirmado antes de devolver o erro; pedidos concorrentes são serializados
  pelo bloqueio do utilizador na transação.
- O consumo do código, a mudança da palavra-passe e o incremento de
  `auth_version` são feitos na mesma transação. O código deixa de poder ser
  utilizado e as sessões anteriores da API e do backoffice são invalidadas.
  A nova palavra-passe exige pelo menos 8 caracteres, até 72 bytes em UTF-8
  (limite do bcrypt), e não pode começar pelo prefixo reservado `google-`.
- A recuperação não inicia sessão automaticamente. O frontend limpa a sessão
  local após sucesso e apresenta um botão para iniciar sessão.
- Há um intervalo mínimo de um minuto entre emails da mesma conta e um máximo
  de cinco envios por hora, controlados na BD. Por IP e por processo: 10 pedidos
  de recuperação e 30 tentativas de redefinição por 15 minutos. Para múltiplas
  réplicas, os limites por IP devem passar para armazenamento partilhado.
- O formulário apresenta a contagem até ao reenvio e permite alterar o email.
  O email e a data do pedido são guardados em `sessionStorage` para retomar o
  formulário após recarregar a página na mesma aba, durante os 10 minutos.
  Código e palavra-passe não são persistidos; são limpos ao sair do ecrã.
- O email tem HTML e texto simples. O template está em
  `templates/emails/password-reset.ejs`; o logótipo é incorporado por CID a partir
  de `templates/emails/assets/na-grade-logo.png`, copiado do frontend.
- Falhas do fornecedor são registadas sem email, código ou corpo do pedido.
  O código desse envio é expirado, preservando os limites de envio da conta.
  A aceitação pelo Resend não garante entrega na caixa de entrada; consultar o
  painel do fornecedor em caso de falhas ou limites de entrega.
- As páginas têm `noindex` e as respostas dos endpoints usam `no-store`.

Não foram enviados emails reais durante a implementação.
