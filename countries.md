As cidades têm país associado? Era importante porque eu gostava de caminhar esta app para o público português e por zonas. Apesar de "deixar" ter concertos estrangeiros, o foco será claramente portugal e era importante criar mecanismos para ter esses filtros

3:12 PM

Worked for 2m 4s

Ainda não. Confirmei no Railway: as cidades têm nome e um campo state, mas não têm país associado.

Há uma base útil, mas precisa de normalização:

- Existem 497 cidades, das quais 22 sem state.
- Há nomes como “Lisboa” e “Lisbon” em registos separados.
- O state mistura valores como “Lisbon”, “Azores” e nomes de distritos, com algumas associações a rever.
- A importação do setlist.fm já recebe o país, mas não o guarda — [código (line 476)](/Users/carlosfranco/Sites/mygigs-api/services/setlistFmImport.js:476).
- O nome da cidade é atualmente único em toda a base de dados, o que pode juntar localidades com o mesmo nome em países diferentes.
  Para o rumo que queres dar à app, começaria por estruturar a geografia e depois acrescentaria os filtros.
  Informação Utilidade
  País, com código como PT ou ES Separar Portugal dos concertos no estrangeiro
  Distrito ou região autónoma normalizados Permitir filtros geográficos consistentes
  Município e identificador da localidade na fonte Distinguir localidades com nomes iguais
  Zona de descoberta da app Agrupar a oferta de uma forma simples para o público

Para as zonas de descoberta, proporia inicialmente: Norte, Centro, Lisboa e arredores, Alentejo, Algarve, Açores e Madeira. Seriam agrupamentos definidos para a navegação da app, com uma correspondência explícita entre localidades e zonas.

Na experiência do utilizador, faria assim:

- Agenda pública e página inicial: Portugal selecionado por defeito, com possibilidade de escolher outro país ou todos.
- Dentro de Portugal: filtro por zona e, depois, por cidade.
- Histórico e estatísticas pessoais: todos os países por defeito, para continuar a incluir as viagens do utilizador.
- Filtros guardados entre visitas, com a seleção sempre visível.
- Filtragem na API, antes da paginação, para os resultados e as contagens serem corretos.
  A primeira fase seria guardar o país nas novas importações e classificar os registos existentes, normalizando também os distritos. Não atribuiria PT automaticamente a todas as cidades: já existem Madrid, Barcelona e outras localidades estrangeiras.

Há ainda coordenadas guardadas em 3 080 dos 3 147 locais, que podem ajudar nessa classificação e, mais tarde, permitir uma opção “Perto de mim”.

Esta estrutura dá prioridade clara a Portugal e mantém os concertos estrangeiros integrados no histórico da app. Ainda não alterei código nem dados.

3:14 PM

Parece-me perfeito. Divide isso em tarefas para eu ir validando se estás no caminho certo

3:16 PM

Dividiria em sete tarefas, com uma entrega concreta para validares no fim de cada uma.

1. Auditar os dados geográficos existentes
   Identificar cidades duplicadas, países em falta, distritos inconsistentes e localidades ambíguas.
   Para validares: relatório com exemplos e proposta de correção, sem alterar dados.
2. Definir o modelo geográfico e as zonas
   Preparar os campos de país, distrito/região autónoma, município e identificador da fonte. Definir a correspondência com Norte, Centro, Lisboa e arredores, Alentejo, Algarve, Açores e Madeira.
   Para validares: estrutura proposta, limites das zonas e tratamento das localidades ainda por classificar.
3. Adaptar a criação e importação de localidades
   Passar a guardar o país recebido do setlist.fm e distinguir localidades com nomes iguais. Adaptar os formulários, mantendo os registos antigos compatíveis.
   Para validares: exemplos de criação/importação em Portugal e no estrangeiro.
4. Classificar e corrigir os dados existentes
   Preparar o preenchimento dos países e zonas, com indicação da origem e dos casos duvidosos. Tratar nomes alternativos, como Lisboa/Lisbon, preservando as ligações aos concertos.
   Para validares: lista das alterações antes da aplicação no Railway. Os casos ambíguos ficam pendentes.
5. Acrescentar os filtros à API
   Filtrar por país, zona e cidade, com contagens e paginação coerentes. Reutilizar os mesmos critérios nos concertos, eventos, festivais e locais.
   Para validares: resultados concretos para combinações como Portugal → Norte → Porto.
6. Adicionar os filtros à interface pública
   Colocar Portugal por defeito e permitir escolher zona, cidade, outros países ou todos. Aplicar a seleção à página inicial e às páginas de descoberta.
   Para validares: apresentação em telemóvel e computador, clareza da seleção e facilidade de limpar filtros.
7. Guardar preferências e acertar a área pessoal
   Recordar os filtros entre visitas. Manter o histórico e as estatísticas pessoais com todos os países por defeito, permitindo filtrá-los explicitamente.
   Para validares: persistência das escolhas e inclusão dos concertos no estrangeiro no histórico.
   Avanço uma tarefa de cada vez e espero pela tua validação antes da seguinte. A primeira entrega será a auditoria dos dados atuais.

---

## Estado de implementação — 30 de outubro de 2026

A auditoria (tarefa 1) foi aceite. As tarefas 2–7 estão implementadas no código e a migração geográfica foi aplicada no Railway:

2. **Modelo e zonas:** país, divisão administrativa, município opcional, identificador/origem da fonte e sete zonas de descoberta, com possibilidade de exceção por cidade.
3. **Criação e importação:** país e identificador da cidade guardados nas importações; localidades homónimas distinguidas pelo contexto; formulário administrativo para criar/editar cidades.
4. **Classificação:** preservadas as 488 cidades auditadas, incluindo 469 portuguesas e 19 estrangeiras; atribuídas as sete zonas portuguesas. Mantêm-se os IDs e relações. Os campos sem evidência suficiente não são inventados.
5. **API:** filtro comum por país/zona/cidade em concertos, eventos, locais, festivais, próximas edições, estatísticas e conteúdos da Home, antes da paginação e nas contagens.
6. **Interface pública:** seletores de país/zona/cidade, Portugal por defeito na primeira visita, seleção visível, pesquisa de cidade e limpeza dos filtros.
7. **Preferências e área pessoal:** preferências públicas e pessoais independentes, persistidas no dispositivo; histórico pessoal com todos os países por defeito; filtros mantidos na navegação para a pesquisa.

As zonas são agrupamentos do produto com uma correspondência inicial por distrito, documentada em [docs/geography.md](docs/geography.md). A mesma documentação descreve os endpoints, regras de classificação, migração e verificação.

A publicação do código da API e do frontend ainda é necessária para disponibilizar a funcionalidade no ambiente publicado. A migração da base de dados já está aplicada.
