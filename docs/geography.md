# Geografia e filtros de descoberta

Implementação das tarefas 2–7 do `countries.md`, em 30 de outubro de 2026.

## Modelo e classificação

- `country` e `country_subdivision`: países e divisões administrativas já auditados.
- `discovery_zone`: as sete zonas de navegação da app.
- `country_subdivision.zone_code`: zona base do distrito/região.
- `city.country_code`, `subdivision_id`, `municipality`: localização da cidade.
- `city.zone_code`: exceção explícita à zona do distrito, quando necessário.
- `city.source`, `source_id`: identificador recebido do setlist.fm; `geography_source` regista a origem da classificação.
- `classification_status`: `confirmed` ou `pending`. Um país desconhecido mantém-se nulo, sem atribuição automática de Portugal.

Os campos de município e identificador da fonte são opcionais. Não são inventados para os registos antigos. O nome de cidade deixou de ser globalmente único: a chave geográfica inclui país, divisão, município e identificador da fonte. A criação manual e as importações procuram uma correspondência inequívoca; localidades homónimas ou de países diferentes não são escolhidas apenas pelo primeiro resultado.

A importação preserva classificações auditadas, guarda o país e o identificador da cidade recebidos da fonte e mantém o texto de `state` quando não existe uma divisão administrativa reconhecida. A normalização Lisboa/Lisbon só é aplicada no contexto português ou nos caminhos antigos sem país explícito. A pré-visualização de outras fontes deixa localidades ambíguas para seleção manual.

## Zonas de descoberta

São agrupamentos do produto com uma correspondência inicial por distrito; não representam a classificação administrativa/NUTS. O campo de exceção da cidade permite ajustar uma localidade sem alterar o distrito ou o país.

| Código | Nome | Distritos/regiões de base |
| --- | --- | --- |
| `norte` | Norte | Viana do Castelo, Braga, Porto, Vila Real, Bragança |
| `centro` | Centro | Aveiro, Coimbra, Viseu, Guarda, Castelo Branco, Leiria, Santarém |
| `lisboa` | Lisboa e arredores | Lisboa, Setúbal |
| `alentejo` | Alentejo | Beja, Évora, Portalegre |
| `algarve` | Algarve | Faro |
| `acores` | Açores | Açores |
| `madeira` | Madeira | Madeira |

## Migração repetível

```sh
npm run migrate:geography
npm run migrate:geography -- --apply
```

Sem `--apply`, apresenta o plano sem ligar à base de dados. Com `--apply`, cria os campos/tabelas/índices em falta e aplica as classificações de `data/audited-city-geography.json`, apenas quando o ID e o nome continuam a corresponder e não há um país contraditório. Os IDs e relações existentes são preservados. A migração usa um bloqueio por base de dados e uma transação para a classificação; o DDL do MySQL é aditivo e pode ser retomado após uma interrupção.

A migração foi aplicada no Railway em 30 de outubro de 2026. Foram preservadas 488 cidades: 469 portuguesas, distribuídas pelas sete zonas, e 19 estrangeiras. Não havia cidades sem país nesse conjunto auditado. As cidades novas sem evidência suficiente continuam por classificar.

A API precisa de acesso às novas colunas e de SELECT em `discovery_zone`, `country` e `country_subdivision`; as importações também podem acrescentar países recebidos da fonte.

## API

Os filtros são opcionais para manter compatibilidade com clientes existentes:

- `country_code=PT`, outro código de duas letras, `all` ou `unknown`.
- `zone=norte` (apenas com `country_code=PT`).
- `city_id=64` (ID positivo da cidade).

Um país por classificar é selecionado com `unknown`; `all` inclui todos os países e registos por classificar. Combinações país/zona inválidas devolvem HTTP 400. Uma cidade que não corresponde aos restantes filtros não devolve resultados.

Os mesmos critérios são aplicados antes da paginação e às contagens nos endpoints de concertos, eventos, locais, festivais, próximas edições, estatísticas e últimos conteúdos da Home. Os festivais são filtrados pela localização das suas edições sem duplicar o festival.

`GET /api/geography` devolve países, zonas, divisões e cidades disponíveis. Aceita país/zona para reduzir a lista de cidades. Os nomes de apresentação incluem o contexto geográfico para distinguir homónimos.

Exemplos:

```text
/api/gig?period=past&country_code=PT&zone=norte&city_id=64
/api/gig/dashboard?period=past&scope=global&country_code=PT&zone=norte&city_id=64
/api/event?period=upcoming&country_code=PT&zone=centro
/api/festival?country_code=PT&zone=algarve
/api/venue?country_code=ES
/api/geography?country_code=PT&zone=norte
```

Após a migração, a consulta de leitura de Portugal → Norte → Porto devolveu 1 032 concertos tanto na lista como no dashboard global.

## Interface e preferências

- Home, concertos, eventos, festivais e locais: Portugal por defeito na primeira visita.
- Dashboard pessoal, pesquisa pessoal e listas «Os meus»/«Favoritos»: todos os países por defeito.
- As duas preferências são guardadas separadamente no dispositivo (`mygigs-geography-discovery` e `mygigs-geography-personal`). Alterar a descoberta pública não restringe o histórico pessoal.
- País → zona → cidade: mudar um nível limpa os níveis dependentes. A cidade permite pesquisa por texto; a seleção ativa mantém-se visível.
- «Limpar filtros» mostra todos os países. É possível regressar a Portugal no seletor.
- A navegação da Home/dashboard para a pesquisa mantém os filtros no URL; uma seleção explícita no URL prevalece sobre a preferência guardada.
- Alterar os filtros reinicia a paginação e cancela pedidos anteriores. As páginas mantidas em memória voltam a carregar ao regressar se a preferência mudou.
- Na criação/edição de locais, os administradores podem criar e corrigir cidades, incluindo país, distrito, município e uma exceção de zona. Os nomes completos distinguem localidades homónimas.

## Verificação e entrega

Compilação de desenvolvimento e verificação de sintaxe da API; consultas de leitura no Railway. Não foram criados nem executados testes automáticos, conforme o `AGENTS.md`.

A migração da base de dados foi aplicada. A publicação do código da API e do frontend é uma etapa separada; o código deve ser publicado em conjunto para disponibilizar o novo endpoint de opções e os seletores.

## Catálogo internacional

Os seletores incluem os países e territórios com códigos regulares do [Unicode CLDR](https://github.com/unicode-org/cldr/blob/main/common/validity/region.xml), com [nomes em português de Portugal](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-localenames-full/main/pt-PT/territories.json). O catálogo em `data/countries.json` foi obtido em 30 de outubro de 2026; os nomes já auditados na base de dados têm precedência. A licença da fonte está em `data/UNICODE-LICENSE.txt`.

Isto permite criar uma cidade num país ainda sem concertos na app. O país só é acrescentado à tabela quando é efetivamente utilizado; escolher um país no filtro não escreve na base de dados.
