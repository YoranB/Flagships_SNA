const DATA = JSON.parse(document.getElementById('sna-data').textContent);
    const personsById = new Map(DATA.persons.map(p => [p.id, p]));
    const flagshipsById = new Map([...DATA.flagships, ...DATA.selected_flagship_groups].map(f => [f.id, f]));
    const edgesByPerson = new Map();
    const activeState = {
      view: 'flagships',
      selectedOnly: false,
      selectedFlagship: '',
      selectedPerson: '',
      flagshipFocusPerson: '',
      selectedInstitution: '',
      selectedDepartment: '',
      keyword: '',
      groupMode: 'none',
      minWeight: 1,
      hopDepth: 1,
      edgeMode: 'backbone',
      currentNodes: [],
      currentEdges: [],
    };

    for (const edge of DATA.edges) {
      if (!edgesByPerson.has(edge.source)) edgesByPerson.set(edge.source, []);
      if (!edgesByPerson.has(edge.target)) edgesByPerson.set(edge.target, []);
      edgesByPerson.get(edge.source).push(edge);
      edgesByPerson.get(edge.target).push(edge);
    }

    const departmentPalette = [
      '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0369a1', '#4d7c0f',
      '#c2410c', '#4338ca', '#047857', '#a21caf', '#ca8a04', '#0e7490'
    ];
    const colorForInstitution = (institution) => DATA.institution_colors[institution] || '#64748b';
    function hashColor(value) {
      const text = String(value || 'Unknown');
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) - hash) + text.charCodeAt(i);
        hash |= 0;
      }
      return departmentPalette[Math.abs(hash) % departmentPalette.length];
    }
    const colorForDepartment = (department) => department === 'Unknown' ? '#8a8f98' : hashColor(department);
    function groupColorForPerson(person) {
      if (activeState.groupMode === 'department') return colorForDepartment(person.department_group);
      return colorForInstitution(person.institution_clean || person.institution);
    }
    function groupLabelForPerson(person) {
      if (activeState.groupMode === 'department') return person.department_group || 'Unknown';
      if (activeState.groupMode === 'institution') return person.institution_clean || person.institution || 'Unknown';
      return person.institution || 'Unknown';
    }
    const fmt = new Intl.NumberFormat('nl-NL');

    const network = new vis.Network(
      document.getElementById('network'),
      { nodes: new vis.DataSet([]), edges: new vis.DataSet([]) },
      {
        autoResize: true,
        interaction: { hover: true, tooltipDelay: 120, navigationButtons: true, keyboard: true },
        physics: {
          enabled: true,
          stabilization: { iterations: 180, updateInterval: 20 },
          barnesHut: { gravitationalConstant: -4600, springLength: 145, springConstant: 0.035, damping: 0.25 }
        },
        nodes: {
          shape: 'dot',
          borderWidth: 1,
          font: { size: 13, face: 'Inter, system-ui, sans-serif', color: '#111827', strokeWidth: 3, strokeColor: '#ffffff' }
        },
        edges: {
          color: { color: '#b7c0cc', highlight: '#155eef', hover: '#155eef' },
          smooth: { type: 'dynamic' },
          font: { size: 11, align: 'middle', color: '#475467', strokeWidth: 3, strokeColor: '#ffffff' }
        }
      }
    );

    network.once('stabilizationIterationsDone', () => network.setOptions({ physics: false }));

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
      }[ch]));
    }

    function personNode(person, showLabel = false) {
      const size = 12 + Math.min(32, Math.sqrt(Math.max(person.weighted_degree, person.degree)) * 3.2);
      const color = groupColorForPerson(person);
      return {
        id: person.id,
        label: showLabel ? person.name : '',
        value: Math.max(1, person.weighted_degree),
        size,
        color: {
          background: color,
          border: person.is_placeholder ? '#111827' : '#ffffff'
        },
        group: groupLabelForPerson(person),
        kind: 'person',
      };
    }

    function departmentDisplay(person) {
      const clean = person.department_clean || person.department || '-';
      const raw = person.department_raw || '';
      if (raw && clean && raw !== clean && clean !== '-') {
        return `${clean} (ruw: ${raw})`;
      }
      return clean;
    }

    function renderPersonTooltipContent(person) {
      const swatch = groupColorForPerson(person);
      return `
        <div class="tooltip-title">
          <span class="swatch" style="background:${swatch}"></span>
          <span>${escapeHtml(person.name)}</span>
        </div>
        <div class="tooltip-grid">
          <span>Instelling</span><span>${escapeHtml(person.institution_clean || person.institution || '-')}</span>
          <span>Afdeling</span><span>${escapeHtml(departmentDisplay(person))}</span>
          <span>Groep</span><span>${escapeHtml(groupLabelForPerson(person))}</span>
          <span>Degree</span><span>${person.degree}</span>
          <span>Betweenness</span><span>${person.betweenness.toFixed(4)}</span>
          <span>Flagships</span><span>${person.n_flagships}</span>
        </div>
        <div class="tooltip-hint">Klik om details of dit persoonsnetwerk te openen.</div>
      `;
    }

    function showPersonTooltip(person, pointer) {
      const tooltip = document.getElementById('personTooltip');
      const networkRect = document.getElementById('network').getBoundingClientRect();
      const x = networkRect.left + (pointer?.x ?? 0) + 16;
      const y = networkRect.top + (pointer?.y ?? 0) + 16;

      tooltip.innerHTML = renderPersonTooltipContent(person);
      tooltip.classList.add('visible');
      tooltip.setAttribute('aria-hidden', 'false');

      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 12;
      const left = Math.min(
        Math.max(margin, x),
        window.innerWidth - tooltipRect.width - margin
      );
      const top = Math.min(
        Math.max(margin, y),
        window.innerHeight - tooltipRect.height - margin
      );

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }

    function hidePersonTooltip() {
      const tooltip = document.getElementById('personTooltip');
      tooltip.classList.remove('visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }

    function openPersonNetwork(personId) {
      activeState.selectedPerson = personId;
      activeState.flagshipFocusPerson = '';
      document.getElementById('personSearch').tomselect.setValue(personId, true);
      setView('person');
    }

    function flagshipNode(flagship) {
      return {
        id: flagship.id,
        label: flagship.title.length > 34 ? flagship.title.slice(0, 31) + '...' : flagship.title,
        title: `<b>${escapeHtml(flagship.title)}</b><br>${flagship.n_applicants} personen<br>${flagship.n_institutions} instellingen`,
        value: flagship.n_applicants,
        size: 16 + Math.min(36, flagship.n_applicants / 2),
        color: { background: '#155eef', border: '#ffffff' },
        font: { size: 12 },
        kind: 'flagship',
      };
    }

    function edgeLabel(weight) {
      return weight > 1 ? String(weight) : '';
    }

    function edgeKey(edge) {
      return `${edge.source}--${edge.target}`;
    }

    function visibleFlagships() {
      return activeState.selectedOnly ? DATA.selected_flagship_groups : DATA.flagships;
    }

    function visibleFlagshipLinks() {
      return activeState.selectedOnly ? DATA.selected_flagship_links : DATA.flagship_links;
    }

    function flagshipMemberIds(flagship) {
      return flagship.member_ids && flagship.member_ids.length ? flagship.member_ids : [flagship.id];
    }

    function flagshipLabel(flagship) {
      return activeState.selectedOnly && flagship.member_ids.length > 1
        ? `${flagship.title} (${flagship.member_ids.join(' + ')})`
        : flagship.title;
    }

    function updateFlagshipControls() {
      const current = activeState.selectedFlagship;
      const options = visibleFlagships().sort((a, b) => a.title.localeCompare(b.title));
      const flagshipSelect = document.getElementById('flagshipSelect');
      flagshipSelect.innerHTML = '<option value="">Alle flagships</option>' + options
        .map(flagship => `<option value="${escapeHtml(flagship.id)}">${escapeHtml(flagship.id.startsWith('selected:') ? flagship.title : flagship.id + ' · ' + flagship.title)}</option>`)
        .join('');
      if (current && flagshipsById.has(current) && options.some(flagship => flagship.id === current)) {
        flagshipSelect.value = current;
      } else {
        activeState.selectedFlagship = '';
        flagshipSelect.value = '';
      }
    }

    function setNetwork(nodes, edges, title, subtitle) {
      activeState.currentNodes = nodes;
      activeState.currentEdges = edges;
      document.getElementById('viewNodes').textContent = fmt.format(nodes.length);
      document.getElementById('viewEdges').textContent = fmt.format(edges.length);
      document.getElementById('viewTitle').textContent = title;
      document.getElementById('viewSubtitle').textContent = subtitle;

      network.setData({
        nodes: new vis.DataSet(nodes),
        edges: new vis.DataSet(edges),
      });
      network.setOptions({ physics: { enabled: true } });
      window.setTimeout(() => {
        network.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
      }, 120);
      window.setTimeout(() => network.setOptions({ physics: false }), 900);
    }

    function passInstitution(person) {
      const institution = person.institution_clean || person.institution;
      return !activeState.selectedInstitution || institution === activeState.selectedInstitution;
    }

    function passDepartment(person) {
      return !activeState.selectedDepartment || person.department_group === activeState.selectedDepartment;
    }

    function passKeyword(person) {
      if (!activeState.keyword) return true;
      return (person.search_text || '').includes(activeState.keyword);
    }

    function passPersonFilters(person) {
      return passInstitution(person) && passDepartment(person) && passKeyword(person);
    }

    function passWeight(edge) {
      return Number(edge.weight || 1) >= activeState.minWeight;
    }

    function maxEdgeCount(nodeCount) {
      const scaled = Math.round(nodeCount * 1.25);
      const smallGraphCap = nodeCount < 25 ? Math.round(nodeCount * 2) : 60;
      return Math.min(160, Math.max(nodeCount - 1, scaled, smallGraphCap));
    }

    function personEdgeWidth(edge) {
      return 0.8 + Math.min(3.5, Math.sqrt(Number(edge.weight || 1)) * 0.8);
    }

    function chooseBackboneEdges(edges, nodeIds) {
      const cap = maxEdgeCount(nodeIds.size);
      const parent = new Map([...nodeIds].map(id => [id, id]));
      const rank = new Map([...nodeIds].map(id => [id, 0]));
      const find = (id) => {
        let root = parent.get(id);
        while (root !== parent.get(root)) root = parent.get(root);
        while (id !== root) {
          const next = parent.get(id);
          parent.set(id, root);
          id = next;
        }
        return root;
      };
      const union = (a, b) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA === rootB) return false;
        if (rank.get(rootA) < rank.get(rootB)) {
          parent.set(rootA, rootB);
        } else if (rank.get(rootA) > rank.get(rootB)) {
          parent.set(rootB, rootA);
        } else {
          parent.set(rootB, rootA);
          rank.set(rootA, rank.get(rootA) + 1);
        }
        return true;
      };

      const sorted = [...edges].sort((a, b) =>
        b.weight - a.weight ||
        (personsById.get(b.source)?.betweenness || 0) + (personsById.get(b.target)?.betweenness || 0) -
        ((personsById.get(a.source)?.betweenness || 0) + (personsById.get(a.target)?.betweenness || 0))
      );
      const chosen = [];
      const seen = new Set();
      for (const edge of sorted) {
        if (union(edge.source, edge.target)) {
          chosen.push(edge);
          seen.add(edgeKey(edge));
        }
      }
      for (const edge of sorted) {
        if (chosen.length >= cap) break;
        const key = edgeKey(edge);
        if (seen.has(key)) continue;
        chosen.push(edge);
        seen.add(key);
      }
      return chosen;
    }

    function selectFlagshipEdges(edges, visibleIds) {
      if (activeState.edgeMode === 'all') return edges;
      if (activeState.edgeMode === 'selection') {
        if (!activeState.flagshipFocusPerson) return [];
        return edges.filter(edge => edge.source === activeState.flagshipFocusPerson || edge.target === activeState.flagshipFocusPerson);
      }
      if (activeState.flagshipFocusPerson) {
        const focusEdges = edges.filter(edge => edge.source === activeState.flagshipFocusPerson || edge.target === activeState.flagshipFocusPerson);
        const focusKeys = new Set(focusEdges.map(edgeKey));
        const backbone = chooseBackboneEdges(edges, visibleIds).filter(edge => !focusKeys.has(edgeKey(edge)));
        return [...focusEdges, ...backbone].slice(0, maxEdgeCount(visibleIds.size));
      }
      return chooseBackboneEdges(edges, visibleIds);
    }

    function renderFlagshipOverview() {
      updateFlagshipControls();
      const nodes = visibleFlagships().map(flagshipNode);
      const edges = visibleFlagshipLinks()
        .filter(link => link.weight >= activeState.minWeight)
        .map(link => ({
          id: `${link.source}--${link.target}`,
          from: link.source,
          to: link.target,
          value: link.weight,
          width: 1 + Math.sqrt(link.weight),
          label: edgeLabel(link.weight),
          title: `${link.weight} gedeelde persoon/personen`,
          kind: 'flagship-link',
        }));
      const label = activeState.selectedOnly ? 'Gekozen flagships' : 'Flagship-overzicht';
      setNetwork(nodes, edges, label, 'Klik op een flagship om deelnemers en co-applicant relaties te zien.');
      markActiveFlagship('');
      document.getElementById('selectionDetails').innerHTML = '<div class="subtle">Selecteer een node of edge in het netwerk.</div>';
    }

    function renderFlagship(flagshipId) {
      const flagship = flagshipsById.get(flagshipId);
      if (!flagship) return renderFlagshipOverview();
      const memberIds = flagshipMemberIds(flagship);

      const people = DATA.persons.filter(person =>
        person.flagships.some(item => memberIds.includes(item.id)) && passPersonFilters(person)
      );
      const peopleIds = new Set(people.map(person => person.id));
      const filteredEdges = DATA.edges.filter(edge =>
        peopleIds.has(edge.source) &&
        peopleIds.has(edge.target) &&
        edge.flagships.some(id => memberIds.includes(id)) &&
        passWeight(edge)
      );
      const connectedIds = new Set(filteredEdges.flatMap(edge => [edge.source, edge.target]));
      const visiblePeople = people.filter(person => connectedIds.has(person.id) || people.length <= 80);
      const visibleIds = new Set(visiblePeople.map(person => person.id));

      const topIds = new Set([...visiblePeople]
        .sort((a, b) => b.betweenness - a.betweenness || b.weighted_degree - a.weighted_degree)
        .slice(0, 12)
        .map(person => person.id));

      const nodes = visiblePeople.map(person => personNode(person, topIds.has(person.id)));
      const allVisibleEdges = filteredEdges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));
      const displayedEdges = selectFlagshipEdges(allVisibleEdges, visibleIds);
      const edges = displayedEdges
        .map(edge => ({
          id: `${edge.source}--${edge.target}--${flagshipId}`,
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          title: `${escapeHtml(flagship.title)}<br>Weight: ${edge.weight}<br>${escapeHtml(edge.flagship_titles.join('; '))}`,
          kind: 'person-edge',
        }));

      const modeLabel = activeState.edgeMode === 'all' ? 'alle edges' : activeState.edgeMode === 'selection' ? 'selectie-edges' : 'backbone';
      const focus = activeState.flagshipFocusPerson ? ` rond ${personsById.get(activeState.flagshipFocusPerson)?.name || 'selectie'}` : '';
      setNetwork(nodes, edges, flagship.title, `${visiblePeople.length} personen, ${edges.length}/${allVisibleEdges.length} relaties getoond (${modeLabel}${focus}).`);
      markActiveFlagship(flagshipId);
      showFlagshipDetails(flagship, edges.length, allVisibleEdges.length);
    }

    function collectNeighborhood(personId, depth) {
      const selected = new Set([personId]);
      const traversedEdges = new Set();
      let frontier = new Set([personId]);
      for (let step = 0; step < depth; step++) {
        const next = new Set();
        for (const id of frontier) {
          for (const edge of edgesByPerson.get(id) || []) {
            if (!passWeight(edge)) continue;
            traversedEdges.add(edgeKey(edge));
            const other = edge.source === id ? edge.target : edge.source;
            if (!selected.has(other)) {
              selected.add(other);
              next.add(other);
            }
          }
        }
        frontier = next;
      }
      return { selected, traversedEdges };
    }

    function renderPersonNeighborhood(personId) {
      const person = personsById.get(personId);
      if (!person) return;
      const neighborhood = collectNeighborhood(personId, activeState.hopDepth);
      const people = [...neighborhood.selected]
        .map(id => personsById.get(id))
        .filter(person => person && (person.id === personId || passPersonFilters(person)));
      const peopleIds = new Set(people.map(person => person.id));
      const edges = DATA.edges
        .filter(edge => neighborhood.traversedEdges.has(edgeKey(edge)) && peopleIds.has(edge.source) && peopleIds.has(edge.target) && passWeight(edge))
        .map(edge => ({
          id: edgeKey(edge),
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          label: edge.weight > 2 ? String(edge.weight) : '',
          title: `Weight: ${edge.weight}<br>${escapeHtml(edge.flagship_titles.join('; '))}`,
          kind: 'person-edge',
        }));

      const nodes = people.map(item => personNode(item, item.id === personId || item.betweenness >= 0.02));
      setNetwork(nodes, edges, person.name, `${activeState.hopDepth}-hop netwerk rond geselecteerde persoon.`);
      showPersonDetails(person);
    }

    function renderTopConnectors() {
      const people = DATA.persons
        .filter(passPersonFilters)
        .sort((a, b) => b.betweenness - a.betweenness || b.n_flagships - a.n_flagships || b.weighted_degree - a.weighted_degree)
        .slice(0, 50);
      const ids = new Set(people.map(person => person.id));
      const edges = DATA.edges
        .filter(edge => ids.has(edge.source) && ids.has(edge.target) && passWeight(edge))
        .map(edge => ({
          id: `${edge.source}--${edge.target}`,
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          title: `Weight: ${edge.weight}<br>${escapeHtml(edge.flagship_titles.join('; '))}`,
          kind: 'person-edge',
        }));
      const nodes = people.map(person => personNode(person, true));
      setNetwork(nodes, edges, 'Top connectoren', `${people.length} personen gesorteerd op betweenness, flagships en weighted degree.`);
    }

    function renderActiveView() {
      activeState.selectedOnly = document.getElementById('selectedOnlyToggle').checked;
      activeState.minWeight = Number(document.getElementById('minWeight').value || 1);
      activeState.selectedInstitution = document.getElementById('institutionFilter').value;
      activeState.selectedDepartment = document.getElementById('departmentFilter').value;
      activeState.keyword = document.getElementById('keywordFilter').value.trim().toLowerCase();
      activeState.groupMode = document.getElementById('groupMode').value;
      activeState.selectedFlagship = document.getElementById('flagshipSelect').value;
      activeState.hopDepth = Number(document.getElementById('hopDepth').value || 1);
      activeState.edgeMode = document.getElementById('edgeMode').value;
      updateFlagshipControls();
      renderFlagshipList();

      if (activeState.view === 'person' && activeState.selectedPerson) {
        renderPersonNeighborhood(activeState.selectedPerson);
      } else if (activeState.view === 'connectors') {
        renderTopConnectors();
      } else if (activeState.selectedFlagship) {
        renderFlagship(activeState.selectedFlagship);
      } else {
        renderFlagshipOverview();
      }
      renderConnectorList();
    }

    function showPersonDetails(person) {
      const flagshipRows = person.flagships.map(item => `<div>${escapeHtml(item.id)} · ${escapeHtml(item.title)}</div>`).join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(person.name)}</h3>
        <div class="kv"><span>Instelling</span><span>${escapeHtml(person.institution_clean || person.institution)}</span></div>
        ${person.institution_raw && person.institution_raw !== (person.institution_clean || person.institution) ? `<div class="kv"><span>Instelling ruw</span><span>${escapeHtml(person.institution_raw)}</span></div>` : ''}
        <div class="kv"><span>Afdeling</span><span>${escapeHtml(person.department_clean || person.department || '-')}</span></div>
        <div class="kv"><span>Afdeling groep</span><span>${escapeHtml(person.department_group || 'Unknown')}</span></div>
        ${person.department_raw && person.department_raw !== (person.department_clean || person.department) ? `<div class="kv"><span>Afdeling ruw</span><span>${escapeHtml(person.department_raw)}</span></div>` : ''}
        <div class="kv"><span>Rol</span><span>${escapeHtml(person.role || '-')}</span></div>
        <div class="kv"><span>Email/id</span><span>${escapeHtml(person.email || person.id)}</span></div>
        <div class="kv"><span>Degree</span><span>${person.degree}</span></div>
        <div class="kv"><span>Weighted</span><span>${person.weighted_degree}</span></div>
        <div class="kv"><span>Betweenness</span><span>${person.betweenness.toFixed(4)}</span></div>
        <div class="kv"><span>Community</span><span>${person.community || '-'}</span></div>
        <div class="kv"><span>Flagships</span><span>${flagshipRows || '-'}</span></div>
        ${person.is_placeholder ? '<div class="detail-card"><b>Datakwaliteit:</b> deze node gebruikt een fallback-id omdat de e-mail placeholder-achtig is.</div>' : ''}
      `;
    }

    function showFlagshipDetails(flagship, shownEdges = 0, totalEdges = 0) {
      const connectors = flagship.top_connectors.map(person => `
        <div class="list-item" data-person="${escapeHtml(person.id)}">
          <div class="list-item-title">${escapeHtml(person.name)}</div>
          <div class="subtle">${escapeHtml(person.institution)} · degree ${person.degree} · betw. ${person.betweenness.toFixed(4)}</div>
        </div>
      `).join('');
      const sourceIds = flagshipMemberIds(flagship).join(' + ');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(flagship.title)}</h3>
        <div class="kv"><span>Flagship</span><span>${escapeHtml(flagship.id)}</span></div>
        <div class="kv"><span>Bron ids</span><span>${escapeHtml(sourceIds)}</span></div>
        <div class="kv"><span>Personen</span><span>${flagship.n_applicants}</span></div>
        <div class="kv"><span>Instellingen</span><span>${flagship.n_institutions}</span></div>
        <div class="kv"><span>Edges</span><span>${shownEdges}/${totalEdges} getoond</span></div>
        <div class="kv"><span>Edge mode</span><span>${escapeHtml(activeState.edgeMode)}</span></div>
        <div class="kv"><span>Top</span><span>${connectors || '-'}</span></div>
      `;
    }

    function renderFlagshipList() {
      const list = document.getElementById('flagshipList');
      const sorted = [...visibleFlagships()].sort((a, b) => b.n_applicants - a.n_applicants || a.title.localeCompare(b.title));
      list.innerHTML = sorted.map(flagship => `
        <div class="list-item" data-flagship="${escapeHtml(flagship.id)}">
          <div class="list-item-title">${escapeHtml(flagship.title)}</div>
          <div class="subtle">${escapeHtml(flagship.id.startsWith('selected:') ? flagship.member_ids.join(' + ') : flagship.id)} · ${flagship.n_applicants} personen · ${flagship.n_institutions} instellingen</div>
          <div class="chips">${flagship.institutions.slice(0, 4).map(inst => `<span class="chip"><span class="swatch" style="background:${colorForInstitution(inst)}"></span>${escapeHtml(inst)}</span>`).join('')}</div>
        </div>
      `).join('');
    }

    function renderConnectorList() {
      const list = document.getElementById('connectorList');
      const sorted = [...DATA.persons]
        .filter(passPersonFilters)
        .sort((a, b) => b.betweenness - a.betweenness || b.n_flagships - a.n_flagships || b.degree - a.degree)
        .slice(0, 12);
      list.innerHTML = sorted.map(person => `
        <div class="list-item" data-person="${escapeHtml(person.id)}">
          <div class="list-item-title">${escapeHtml(person.name)}</div>
          <div class="subtle">${escapeHtml(person.institution_clean || person.institution)} · ${escapeHtml(person.department_group || 'Unknown')} · ${person.n_flagships} flagships · degree ${person.degree}</div>
        </div>
      `).join('');
    }

    function renderQualityPanel() {
      const quality = DATA.quality;
      document.getElementById('qualityPanel').innerHTML = `
        <div><b>${fmt.format(quality.people)}</b> personen</div>
        <div><b>${fmt.format(quality.edges)}</b> co-applicant relaties totaal</div>
        <div><b>${fmt.format(quality.flagships)}</b> flagships</div>
        <div><b>${fmt.format(quality.placeholder_person_ids)}</b> placeholder/fallback person ids</div>
        <div><b>${fmt.format(quality.raw_institution_values)}</b> ruwe instellingwaarden → <b>${fmt.format(quality.simplified_institution_values)}</b> genormaliseerd</div>
        <div><b>${fmt.format(quality.raw_department_values || 0)}</b> ruwe afdelingen → <b>${fmt.format(quality.department_groups || 0)}</b> groepen</div>
      `;
    }

    function markActiveFlagship(flagshipId) {
      document.querySelectorAll('[data-flagship]').forEach(item => {
        item.classList.toggle('active', item.dataset.flagship === flagshipId);
      });
    }

    function setView(view) {
      activeState.view = view;
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
      if (view === 'flagships') {
        document.getElementById('personSearch').tomselect.clear(true);
        activeState.selectedPerson = '';
      }
      renderActiveView();
    }

    function initControls() {
      const personOptions = DATA.persons
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(person => ({
          value: person.id,
          text: person.name,
          institution: person.institution_clean || person.institution,
          department: person.department_clean || person.department,
          department_group: person.department_group,
          email: person.email,
        }));
      new TomSelect('#personSearch', {
        options: personOptions,
        valueField: 'value',
        labelField: 'text',
        searchField: ['text', 'institution', 'department', 'department_group', 'email'],
        maxOptions: 200,
        render: {
          option: (data, escape) => `<div><strong>${escape(data.text)}</strong><div class="subtle">${escape(data.institution)} · ${escape(data.department_group || data.department || 'Unknown')} · ${escape(data.email || '')}</div></div>`,
        },
        onChange: value => {
          activeState.selectedPerson = value;
          if (value) setView('person');
        }
      });

      updateFlagshipControls();

      const institutions = [...new Set(DATA.persons.map(person => person.institution_clean || person.institution).filter(Boolean))].sort();
      document.getElementById('institutionFilter').innerHTML =
        '<option value="">Alle instellingen</option>' +
        institutions.map(inst => `<option value="${escapeHtml(inst)}">${escapeHtml(inst)}</option>`).join('');

      const departments = [...new Set(DATA.persons.map(person => person.department_group || 'Unknown').filter(Boolean))].sort();
      document.getElementById('departmentFilter').innerHTML =
        '<option value="">Alle afdelingen</option>' +
        departments.map(dept => `<option value="${escapeHtml(dept)}">${escapeHtml(dept)}</option>`).join('');
      new TomSelect('#departmentFilter', {
        maxOptions: 300,
        onChange: renderActiveView,
      });

      document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
      document.getElementById('applyFilters').addEventListener('click', renderActiveView);
      document.getElementById('fitNetwork').addEventListener('click', () => network.fit({ animation: true }));
      document.getElementById('resetView').addEventListener('click', () => {
        document.getElementById('selectedOnlyToggle').checked = false;
        document.getElementById('flagshipSelect').value = '';
        document.getElementById('institutionFilter').value = '';
        document.getElementById('departmentFilter').tomselect.clear(true);
        document.getElementById('keywordFilter').value = '';
        document.getElementById('groupMode').value = 'none';
        document.getElementById('minWeight').value = '1';
        document.getElementById('hopDepth').value = '1';
        document.getElementById('edgeMode').value = 'backbone';
        document.getElementById('personSearch').tomselect.clear(true);
        activeState.selectedPerson = '';
        activeState.flagshipFocusPerson = '';
        setView('flagships');
      });
      document.getElementById('flagshipSelect').addEventListener('change', event => {
        activeState.selectedFlagship = event.target.value;
        activeState.flagshipFocusPerson = '';
        setView('flagships');
      });
      document.getElementById('selectedOnlyToggle').addEventListener('change', () => {
        activeState.selectedOnly = document.getElementById('selectedOnlyToggle').checked;
        activeState.selectedFlagship = '';
        activeState.flagshipFocusPerson = '';
        updateFlagshipControls();
        setView('flagships');
      });
      document.getElementById('institutionFilter').addEventListener('change', renderActiveView);
      document.getElementById('keywordFilter').addEventListener('input', renderActiveView);
      document.getElementById('groupMode').addEventListener('change', renderActiveView);
      document.getElementById('minWeight').addEventListener('change', renderActiveView);
      document.getElementById('hopDepth').addEventListener('change', renderActiveView);
      document.getElementById('edgeMode').addEventListener('change', () => {
        activeState.flagshipFocusPerson = '';
        renderActiveView();
      });

      document.addEventListener('click', event => {
        const flagshipItem = event.target.closest('[data-flagship]');
        if (flagshipItem) {
          document.getElementById('flagshipSelect').value = flagshipItem.dataset.flagship;
          activeState.selectedFlagship = flagshipItem.dataset.flagship;
          activeState.flagshipFocusPerson = '';
          setView('flagships');
          return;
        }
        const personItem = event.target.closest('[data-person]');
        if (personItem) {
          activeState.selectedPerson = personItem.dataset.person;
          document.getElementById('personSearch').tomselect.setValue(activeState.selectedPerson, true);
          setView('person');
        }
      });
    }

    network.on('click', params => {
      if (!params.nodes.length) return;
      const id = params.nodes[0];
      if (flagshipsById.has(id)) {
        document.getElementById('flagshipSelect').value = id;
        activeState.selectedFlagship = id;
        activeState.flagshipFocusPerson = '';
        renderFlagship(id);
      } else if (personsById.has(id)) {
        if (activeState.view === 'person' || activeState.view === 'connectors') {
          openPersonNetwork(id);
          hidePersonTooltip();
        } else if (activeState.view === 'flagships' && activeState.selectedFlagship) {
          activeState.flagshipFocusPerson = id;
          if (activeState.edgeMode === 'selection') {
            document.getElementById('edgeMode').value = 'selection';
          }
          renderFlagship(activeState.selectedFlagship);
          showPersonDetails(personsById.get(id));
        } else {
          showPersonDetails(personsById.get(id));
        }
      }
    });

    network.on('hoverNode', params => {
      const nodeId = params.node;
      if (!personsById.has(nodeId)) return;
      const person = personsById.get(nodeId);
      network.body.data.nodes.update({ id: nodeId, label: person.name });
      showPersonTooltip(person, params.pointer?.DOM);
    });

    network.on('blurNode', params => {
      const nodeId = params.node;
      if (!personsById.has(nodeId)) return;
      const node = activeState.currentNodes.find(item => item.id === nodeId);
      if (node && !node.label) network.body.data.nodes.update({ id: nodeId, label: '' });
      hidePersonTooltip();
    });

    renderFlagshipList();
    renderConnectorList();
    renderQualityPanel();
    initControls();
    renderFlagshipOverview();
