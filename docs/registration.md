# Registo com confirmação de email

Antes de publicar, aplicar `migrations/20261113_registration_codes.sql` e publicar
esta API e o frontend em conjunto. Reutiliza `RESEND_API_KEY`, `EMAIL_FROM` e
`JWT_SECRET` da recuperação. Não são necessárias novas credenciais.

- `POST /api/user/registration-code` recebe `{ email }`. Normaliza o endereço,
  rejeita contas existentes com 409 e `EMAIL_ALREADY_EXISTS` e envia um código
  de seis dígitos pelo Resend. Não cria uma conta nem guarda uma palavra-passe.
- O código expira em 10 minutos e fica guardado apenas como HMAC-SHA-256,
  separado dos códigos de recuperação. Um novo envio invalida o anterior.
- Há um intervalo mínimo de 60 segundos e um máximo de 5 envios por hora por
  email, controlados na BD entre réplicas. 429 inclui `Retry-After`.
  Falhas de envio devolvem 503 com `EMAIL_DELIVERY_FAILED`, expiram esse código
  e preservam os limites. A aceitação pelo fornecedor não garante a entrega.
- `POST /api/user/register` passa a exigir `{ name, email, password, code }`.
  Valida o código e cria a conta na mesma transação, consumindo o código apenas
  após sucesso. Sem código válido, não existe conta nem token.
- Há um máximo de 5 tentativas erradas por código. O incremento é confirmado
  antes de devolver 400 com `INVALID_REGISTRATION_CODE`. A linha bloqueada
  serializa confirmações e reenvios concorrentes. Códigos da recuperação não
  são aceites no registo, nem o inverso.
- A palavra-passe exige 8 caracteres, até 72 bytes UTF-8 e não pode começar por
  `google-`, tal como na recuperação. Nome obrigatório até 255 caracteres e
  email até 150. As validações são feitas no servidor e no formulário.
- Limites adicionais por IP e por processo: 10 pedidos de código e 30 tentativas
  de registo em 15 minutos. Em várias réplicas, usar armazenamento partilhado
  para os limites por IP.
- O login Google mantém a confirmação de email da Google. Introduzir um email
  Gmail no formulário manual exige o código, tal como qualquer outro domínio.
  As contas existentes continuam a funcionar sem nova confirmação.
- O frontend mostra as etapas de dados, código e conclusão, permite reenviar e
  alterar os dados. Não persiste códigos nem palavras-passe; limpa-os ao sair.
  Após a confirmação apresenta a ligação para iniciar sessão.
- Erros conhecidos têm códigos estáveis e mensagens em português. A interface
  nunca apresenta texto arbitrário da API; erros internos e SQL também são
  ocultados pelo handler da API. Emails duplicados incluem ligações para iniciar
  sessão e recuperar a palavra-passe.
- O email tem HTML e texto simples; o template reutiliza a imagem e o estilo da
  recuperação. As respostas usam `Cache-Control: no-store`.

A migração é aditiva e repetível. As linhas pendentes não contêm contas; para
limpeza periódica, podem apagar-se as que têm `expires_at < UTC_TIMESTAMP()` e
`request_window_start < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`, preservando
sempre as janelas de limitação ativas.
