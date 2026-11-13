# Identificadores públicos dos utilizadores

Os perfis usam `public_id`: 12 caracteres Base64URL, gerados com `crypto.randomBytes(9)` (72 bits aleatórios), permanentes, únicos e sensíveis a maiúsculas. Códigos exclusivamente numéricos são rejeitados. A chave interna `user.id` mantém-se para relações e autorização.

## Publicação

1. Na pasta da API, com a configuração da base de dados de destino, executar `node scripts/migrate-user-public-ids.js --apply`. Acrescenta a coluna e atribui códigos às contas existentes. A coluna fica temporariamente opcional para que a API antiga continue a criar contas até à publicação.
2. Publicar a API e o frontend atualizado num intervalo curto. Há incompatibilidade com clientes antigos que ainda enviem IDs numéricos; atualizar também as aplicações nativas, caso existam.
3. Após publicar a nova API, executar `node scripts/migrate-user-public-ids.js --apply --finalize`. Preenche eventuais contas criadas pela versão antiga entretanto e torna a coluna obrigatória. Não finalizar enquanto houver instâncias da API antiga a aceitar novos registos.

O script sem `--apply` apenas descreve a operação, sem ligação à base de dados. Pode ser retomado após interrupção: preenche apenas valores nulos, preserva os códigos existentes e repete em caso de colisão. Executar apenas o ficheiro SQL não atribui os códigos às contas existentes.

## Contrato

- `GET /api/user/:publicId`, `/api/user/:publicId/photos` e `/api/user/:publicId/countries/:code/gigs` resolvem apenas `public_id`. IDs numéricos e códigos desconhecidos devolvem 404, sem redirecionamento.
- O perfil devolve `user.public_id`, sem `user.id`. Participantes usam `public_id`; comentários, fotografias e reviews usam `user_public_id`, sem `user_id`.
- Registo, login, Google, sessão e `/me` devolvem `public_id` juntamente com os dados privados da própria conta. A validação da sessão atualiza as contas já guardadas no dispositivo.
- A interface compara os identificadores públicos para mostrar as opções de apagar conteúdo. A API continua a validar a propriedade com o ID interno da sessão, sem confiar no cliente.

Os links numéricos antigos deixam de abrir perfis. O código dificulta a enumeração; o perfil continua público e acessível a quem conheça o link.
