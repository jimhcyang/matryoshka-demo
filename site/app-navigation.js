// One bookmark bar for every page; callers may update only its destinations.
(function () {
  const host=document.getElementById('app-navigation');
  if(!host)return;
  const view=host.dataset.view||'home';
  host.innerHTML='<a id="nav-brand" class="app-brand" href="index.html" aria-label="Matryoshka corpus home"><span aria-hidden="true">M</span><b>Matryoshka</b></a>'+
    '<nav class="app-view-tabs" aria-label="Primary navigation">'+
    '<a id="nav-graph" data-view="graph" data-short="Graph" aria-label="Knowledge graph" href="graph-full-v6.html?corpus=cib"><span>Knowledge graph</span></a>'+
    '<a id="nav-workbench" data-view="workbench" data-short="Workbench" aria-label="Analyst workbench" href="workbench-v6.html"><span>Analyst workbench</span></a>'+
    '<a id="nav-live" data-view="live" href="live.html">Live</a>'+
    '<a id="nav-home" data-view="home" data-short="Home" aria-label="Corpus home" href="index.html"><span>Corpus home</span></a></nav>';
  host.querySelector('[data-view="'+view+'"]')?.setAttribute('aria-current','page');
  document.documentElement.dataset.appView=view;
  window.MatryoshkaNavigation={update(destinations={}){
    for(const key of ['graph','workbench','live','home'])if(destinations[key]){
      const url=new URL(destinations[key],location.href);
      if(url.origin!==location.origin)throw Error('Navigation stays within this workbench.');
      document.getElementById('nav-'+key).href=url.pathname+url.search+url.hash;
    }
  }};
})();
