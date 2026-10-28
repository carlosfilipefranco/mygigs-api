# Biografias e estilos dos artistas

A API pede `artist.getInfo` ao Last.fm com `lang=pt`, preferindo o MusicBrainz ID quando é válido. Se esse ID não for reconhecido, procura pelo nome. As biografias não são traduzidas automaticamente: `pt` não garante português de Portugal.

Como o Last.fm pode devolver inglês quando não existe tradução, uma biografia não vazia é comparada com a resposta pedida em inglês. Se os textos forem iguais, depois de retirar o link do Last.fm e normalizar espaços, a biografia fica indisponível em português. Uma falha nesta consulta conserva os dados anteriores. Esta comparação deteta a devolução do mesmo texto inglês; não é um detetor geral de idioma para conteúdo comunitário incorretamente classificado.

`artist_metadata` guarda apenas a biografia, até oito estilos, URL da fonte, idioma e datas de atualização. Os dados são partilhados entre todos os visitantes e entre as páginas do artista e do concerto; não incluem estatísticas pessoais.

- Com biografia: validade de 30 dias.
- Sem biografia em português, incluindo artista não encontrado: nova tentativa após sete dias.
- Falha do serviço: conserva os dados anteriores e aguarda uma hora antes da próxima tentativa automática.
- Com dados guardados: responde imediatamente e atualiza em segundo plano quando o prazo termina.
- Na primeira consulta: aguarda a obtenção dos dados. Cada pedido externo tem um limite de oito segundos.
- Pedidos concorrentes: partilham a atualização em curso no mesmo processo e usam uma reserva de um minuto na base de dados entre processos.
- Não há atualização periódica de artistas sem visitas.

`POST /api/artist/:id/refresh-biography` exige autenticação de administrador e permite atualizar antes do fim da validade. A app disponibiliza a ação na gestão do artista e mantém o conteúdo anterior se falhar. A resposta pública mantém `body.artist.bio` e `body.artist.tags` para compatibilidade e acrescenta `biography` com o estado e a origem.

A interface mostra a fonte com ligação à página do artista no Last.fm, incluindo junto dos estilos. Não apresenta a biografia inglesa como alternativa. Os estilos mantêm a designação devolvida pelo serviço.

## Publicação

Aplicar a migração aditiva e repetível antes de publicar a API e o frontend:

```sh
node scripts/migrate-artist-metadata.js --apply
```

Sem `--apply`, o script apenas apresenta o SQL e não estabelece ligação à base de dados. A migração foi aplicada à base de dados `railway` no Railway em 28 de outubro de 2026; foram confirmadas as colunas, a chave primária por artista/idioma e a relação com `artist` com eliminação em cascata. O utilizador da API precisa de SELECT, INSERT e UPDATE na tabela criada; a criação da tabela deve usar o utilizador de migrações.

`LASTFM_API_KEY` permite configurar a chave no ambiente, com o valor anterior como alternativa durante a transição. A cache é preenchida à medida que os artistas são consultados, sem uma importação inicial de todos os artistas.
