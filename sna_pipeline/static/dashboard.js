    const DATA = JSON.parse(document.getElementById('sna-data').textContent);
    const MANUAL_EXPERTISE_STORAGE_KEY = 'flagships_sna_manual_expertise_edits_v1';
    function loadManualExpertiseEdits() {
      try {
        return JSON.parse(localStorage.getItem(MANUAL_EXPERTISE_STORAGE_KEY) || '{}');
      } catch (error) {
        return {};
      }
    }
    function saveManualExpertiseEdits() {
      try {
        localStorage.setItem(MANUAL_EXPERTISE_STORAGE_KEY, JSON.stringify(manualExpertiseEdits));
      } catch (error) {
        console.warn('Manual expertise edits could not be saved to localStorage.', error);
      }
    }
    function splitKeywords(value) {
      return String(value || '').split(';').map(item => item.trim()).filter(Boolean);
    }
    function mergeKeywordText(left, right) {
      const seen = new Map();
      for (const keyword of [...splitKeywords(left), ...splitKeywords(right)]) {
        const key = keyword.toLowerCase();
        if (!seen.has(key)) seen.set(key, keyword);
      }
      return [...seen.values()].join('; ');
    }
    function expertiseHasContent(person) {
      return Boolean((person.expertise_keywords || '').trim() || (person.expertise_summary || '').trim());
    }
    function applyManualExpertiseEdit(person, edit) {
      if (!person || !edit) return;
      if (!person._base_search_text) {
        person._base_search_text = person.search_text || '';
        person._base_expertise_keywords = person.expertise_keywords || '';
        person._base_expertise_summary = person.expertise_summary || '';
        person._base_expertise_confidence = person.expertise_confidence || '';
        person._base_expertise_origin = person.expertise_origin || '';
        person._base_expertise_manual_note = person.expertise_manual_note || '';
      }
      const hadOnline = person._base_expertise_origin === 'online_enriched' || person._base_expertise_origin === 'online_plus_manual';
      person.expertise_keywords = mergeKeywordText(person._base_expertise_keywords, edit.expertise_keywords);
      person.expertise_summary = edit.expertise_summary || person._base_expertise_summary || '';
      person.expertise_confidence = edit.confidence || person._base_expertise_confidence || '';
      person.expertise_manual_note = edit.source_note || '';
      person.expertise_origin = hadOnline ? 'online_plus_manual' : 'manual';
      person.search_text = `${person._base_search_text || ''} ${person.expertise_keywords || ''} ${person.expertise_summary || ''}`.toLowerCase();
    }
    function applyManualExpertiseEdits() {
      for (const person of DATA.persons) {
        applyManualExpertiseEdit(person, manualExpertiseEdits[person.id]);
      }
    }
    let manualExpertiseEdits = loadManualExpertiseEdits();
    applyManualExpertiseEdits();
    const personsById = new Map(DATA.persons.map(p => [p.id, p]));
    const flagshipsById = new Map([...DATA.flagships, ...DATA.selected_flagship_groups].map(f => [f.id, f]));
    const convergenceOverview = DATA.convergence_overview || { institution_groups: [], flagships: [], ranking: [], network_nodes: [], network_edges: [] };
    const convergenceProfilesById = new Map(convergenceOverview.flagships.map(profile => [profile.id, profile]));
    const edgesByPerson = new Map();
    let globalSearchControl = null;
    const activeState = {
      view: 'flagships',
      selectedOnly: false,
      selectedFlagship: '',
      selectedPerson: '',
      flagshipFocusPerson: '',
      selectedInstitution: '',
      selectedDepartment: '',
      expertiseStatus: '',
      expertiseConfidence: '',
      keyword: '',
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
      if (activeState.selectedDepartment) return colorForDepartment(person.department_group);
      return colorForInstitution(person.institution_clean || person.institution);
    }
    function groupLabelForPerson(person) {
      if (activeState.selectedDepartment) return person.department_group || 'Unknown';
      return person.institution_clean || person.institution || 'Unknown';
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
      const border = person.is_placeholder ? '#111827' : '#ffffff';
      return {
        id: person.id,
        label: showLabel ? person.name : '',
        value: Math.max(1, person.weighted_degree),
        size,
        color: {
          background: color,
          border,
          highlight: { background: color, border },
          hover: { background: color, border }
        },
        group: groupLabelForPerson(person),
        kind: 'person',
      };
    }

    function restorePersonNode(nodeId) {
      const node = activeState.currentNodes.find(item => item.id === nodeId);
      if (!node) return;
      network.body.data.nodes.update({
        id: node.id,
        label: node.label || '',
        value: node.value,
        size: node.size,
        color: node.color,
        group: node.group,
        kind: node.kind,
      });
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
      activeState.keyword = '';
      activeState.flagshipFocusPerson = '';
      if (globalSearchControl) globalSearchControl.setValue(personId, true);
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

    function passExpertiseFilters(person) {
      const hasExpertise = expertiseHasContent(person);
      if (activeState.expertiseStatus === 'with' && !hasExpertise) return false;
      if (activeState.expertiseStatus === 'without' && hasExpertise) return false;
      if (activeState.expertiseConfidence && person.expertise_confidence !== activeState.expertiseConfidence) return false;
      return true;
    }

    function passPersonFilters(person) {
      return passInstitution(person) && passDepartment(person) && passKeyword(person) && passExpertiseFilters(person);
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

    function renderDepartmentNetwork(departmentGroup) {
      const people = DATA.persons
        .filter(person => person.department_group === departmentGroup && passInstitution(person) && passKeyword(person));
      const ids = new Set(people.map(person => person.id));
      const edges = DATA.edges
        .filter(edge => ids.has(edge.source) && ids.has(edge.target) && passWeight(edge))
        .map(edge => ({
          id: edgeKey(edge),
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          label: edge.weight > 2 ? String(edge.weight) : '',
          title: `Weight: ${edge.weight}<br>${escapeHtml(edge.flagship_titles.join('; '))}`,
          kind: 'person-edge',
        }));
      const topIds = new Set([...people]
        .sort((a, b) => b.betweenness - a.betweenness || b.weighted_degree - a.weighted_degree || b.degree - a.degree)
        .slice(0, 12)
        .map(person => person.id));
      const nodes = people.map(person => personNode(person, topIds.has(person.id)));
      setNetwork(nodes, edges, `Afdeling: ${departmentGroup}`, `${people.length} personen, ${edges.length} relaties binnen deze afdeling.`);
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(departmentGroup)}</h3>
        <div class="kv"><span>Personen</span><span>${people.length}</span></div>
        <div class="kv"><span>Relaties</span><span>${edges.length}</span></div>
        <div class="kv"><span>Instellingfilter</span><span>${escapeHtml(activeState.selectedInstitution || 'Alle instellingen')}</span></div>
        <div class="kv"><span>Trefwoord</span><span>${escapeHtml(activeState.keyword || '-')}</span></div>
      `;
      markActiveFlagship('');
    }

    function renderInstitutionNetwork(institution) {
      const people = DATA.persons
        .filter(person => (person.institution_clean || person.institution) === institution && passDepartment(person) && passKeyword(person));
      const ids = new Set(people.map(person => person.id));
      const edges = DATA.edges
        .filter(edge => ids.has(edge.source) && ids.has(edge.target) && passWeight(edge))
        .map(edge => ({
          id: edgeKey(edge),
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          label: edge.weight > 2 ? String(edge.weight) : '',
          title: `Weight: ${edge.weight}<br>${escapeHtml(edge.flagship_titles.join('; '))}`,
          kind: 'person-edge',
        }));
      const topIds = new Set([...people]
        .sort((a, b) => b.betweenness - a.betweenness || b.weighted_degree - a.weighted_degree || b.degree - a.degree)
        .slice(0, 12)
        .map(person => person.id));
      const nodes = people.map(person => personNode(person, topIds.has(person.id)));
      setNetwork(nodes, edges, `Instelling: ${institution}`, `${people.length} personen, ${edges.length} relaties binnen deze instelling.`);
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(institution)}</h3>
        <div class="kv"><span>Personen</span><span>${people.length}</span></div>
        <div class="kv"><span>Relaties</span><span>${edges.length}</span></div>
        <div class="kv"><span>Afdelingfilter</span><span>${escapeHtml(activeState.selectedDepartment || 'Alle afdelingen')}</span></div>
        <div class="kv"><span>Trefwoord</span><span>${escapeHtml(activeState.keyword || '-')}</span></div>
      `;
      markActiveFlagship('');
    }

    function convergenceTooltip(profile) {
      const composition = convergenceOverview.institution_groups
        .map(group => `${escapeHtml(group)}: ${fmt.format(profile.counts[group] || 0)}`)
        .join('<br>');
      const bridgePeople = (profile.top_bridge_people || [])
        .slice(0, 4)
        .map(person => `${escapeHtml(person.name)} (${fmt.format(person.cross_institution_edges)})`)
        .join('<br>') || 'Geen cross-institution bridge people';
      return `<b>${escapeHtml(profile.title)}</b><br>${composition}<br><br><b>Top bridge people</b><br>${bridgePeople}`;
    }

    function convergenceFlagshipNode(flagship) {
      const profile = convergenceProfilesById.get(flagship.id);
      return {
        id: flagship.id,
        label: flagship.title.length > 32 ? flagship.title.slice(0, 29) + '...' : flagship.title,
        title: profile ? convergenceTooltip(profile) : `<b>${escapeHtml(flagship.title)}</b>`,
        value: flagship.n_applicants,
        size: 18 + Math.min(36, flagship.n_applicants / 2),
        color: {
          background: '#7c3aed',
          border: '#ffffff',
          highlight: { background: '#6d28d9', border: '#ffffff' },
          hover: { background: '#6d28d9', border: '#ffffff' }
        },
        font: { size: 12 },
        kind: 'convergence-flagship',
      };
    }

    function renderConvergenceBars() {
      const bars = document.getElementById('convergenceBars');
      bars.innerHTML = convergenceOverview.flagships.map(profile => {
        const total = Math.max(1, profile.total_applicants || 0);
        const segments = convergenceOverview.institution_groups.map(group => {
          const count = profile.counts[group] || 0;
          const width = (count / total) * 100;
          const label = `${group}: ${count}`;
          return `<span class="bar-segment ${count ? '' : 'empty'}" style="width:${width}%;background:${colorForInstitution(group)}" title="${escapeHtml(label)}"></span>`;
        }).join('');
        const tooltip = convergenceOverview.institution_groups
          .map(group => `${group}: ${profile.counts[group] || 0}`)
          .join(' · ');
        return `
          <div class="convergence-bar-row" data-convergence-flagship="${escapeHtml(profile.id)}" title="${escapeHtml(tooltip)}">
            <div class="convergence-bar-title">${escapeHtml(profile.title)}</div>
            <div class="stacked-bar" aria-label="${escapeHtml(profile.title)}">${segments}</div>
            <div class="convergence-total">${fmt.format(profile.total_applicants)} pers.</div>
          </div>
        `;
      }).join('');
    }

    function renderConvergenceRanking() {
      const target = document.getElementById('convergenceRanking');
      target.innerHTML = `
        <table class="convergence-table">
          <thead>
            <tr>
              <th>Flagship</th>
              <th>Score</th>
              <th>Groepen</th>
              <th>Grootste</th>
            </tr>
          </thead>
          <tbody>
            ${convergenceOverview.ranking.map(profile => `
              <tr data-convergence-flagship="${escapeHtml(profile.id)}">
                <td>${escapeHtml(profile.title)}</td>
                <td>${profile.diversity_score.toFixed(3)}</td>
                <td>${profile.n_institution_groups}</td>
                <td>${escapeHtml(profile.largest_group)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    function bindConvergenceItems() {
      document.querySelectorAll('[data-convergence-flagship]').forEach(item => {
        item.addEventListener('click', event => {
          event.stopPropagation();
          showConvergenceFlagshipDetails(item.dataset.convergenceFlagship);
        });
      });
    }

    function showConvergenceFlagshipDetails(profileOrId) {
      const profile = typeof profileOrId === 'string' ? convergenceProfilesById.get(profileOrId) : profileOrId;
      if (!profile) return;
      const composition = convergenceOverview.institution_groups.map(group => `
        <span class="chip"><span class="swatch" style="background:${colorForInstitution(group)}"></span>${escapeHtml(group)}: ${fmt.format(profile.counts[group] || 0)}</span>
      `).join('');
      const bridgePeople = (profile.top_bridge_people || []).map(person => `
        <div class="list-item" data-person="${escapeHtml(person.id)}">
          <div class="list-item-title">${escapeHtml(person.name)}</div>
          <div class="subtle">${escapeHtml(person.institution)} · ${fmt.format(person.cross_institution_edges)} cross-institution relaties · betw. ${person.betweenness.toFixed(4)}</div>
        </div>
      `).join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(profile.title)}</h3>
        <div class="kv"><span>Bron ids</span><span>${escapeHtml(profile.member_ids.join(' + '))}</span></div>
        <div class="kv"><span>Applicants</span><span>${fmt.format(profile.total_applicants)}</span></div>
        <div class="kv"><span>Diversiteit</span><span>${profile.diversity_score.toFixed(4)}</span></div>
        <div class="kv"><span>Instellinggroepen</span><span>${profile.n_institution_groups}</span></div>
        <div class="kv"><span>Grootste groep</span><span>${escapeHtml(profile.largest_group)}</span></div>
        <div class="chips">${composition}</div>
        <div class="kv"><span>Top bridges</span><span>${bridgePeople || '-'}</span></div>
      `;
    }

    function showConvergenceEdgeDetails(edge) {
      const source = convergenceProfilesById.get(edge.source) || flagshipsById.get(edge.source);
      const target = convergenceProfilesById.get(edge.target) || flagshipsById.get(edge.target);
      const shared = (edge.shared_people || []).map(id => personsById.get(id)).filter(Boolean);
      const peopleRows = shared
        .slice(0, 18)
        .map(person => `<div class="list-item" data-person="${escapeHtml(person.id)}"><div class="list-item-title">${escapeHtml(person.name)}</div><div class="subtle">${escapeHtml(person.institution_clean || person.institution)} · ${escapeHtml(person.department_group || 'Unknown')}</div></div>`)
        .join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Gedeelde personen</h3>
        <div class="kv"><span>Flagships</span><span>${escapeHtml(source?.title || edge.source)} ↔ ${escapeHtml(target?.title || edge.target)}</span></div>
        <div class="kv"><span>Aantal</span><span>${fmt.format(edge.weight || shared.length)}</span></div>
        <div class="kv"><span>Personen</span><span>${peopleRows || '-'}</span></div>
      `;
    }

    function renderConvergenceOverview() {
      document.getElementById('convergencePanel').hidden = false;
      renderConvergenceBars();
      renderConvergenceRanking();
      bindConvergenceItems();

      const nodes = convergenceOverview.network_nodes.map(convergenceFlagshipNode);
      const edges = convergenceOverview.network_edges
        .filter(link => link.weight >= activeState.minWeight)
        .map(link => ({
          id: `convergence:${link.source}--${link.target}`,
          from: link.source,
          to: link.target,
          value: link.weight,
          width: 1 + Math.sqrt(link.weight),
          label: edgeLabel(link.weight),
          title: `${link.weight} gedeelde persoon/personen`,
          kind: 'convergence-flagship-link',
          raw: link,
        }));

      setNetwork(nodes, edges, 'Convergence overview', `${nodes.length} gekozen flagships, ${edges.length}/${convergenceOverview.network_edges.length} shared-person relaties getoond.`);
      markActiveFlagship('');
      const multiGroup = convergenceOverview.flagships.filter(profile => profile.n_institution_groups > 1).length;
      const strongest = [...convergenceOverview.network_edges]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5)
        .map(edge => {
          const source = convergenceProfilesById.get(edge.source);
          const target = convergenceProfilesById.get(edge.target);
          return `<div>${escapeHtml(source?.title || edge.source)} ↔ ${escapeHtml(target?.title || edge.target)}: ${fmt.format(edge.weight)}</div>`;
        })
        .join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Convergence</h3>
        <div class="kv"><span>Flagships</span><span>${convergenceOverview.flagships.length}</span></div>
        <div class="kv"><span>Multi-instelling</span><span>${multiGroup}</span></div>
        <div class="kv"><span>Binnen 1 groep</span><span>${convergenceOverview.flagships.length - multiGroup}</span></div>
        <div class="kv"><span>Sterkste links</span><span>${strongest || '-'}</span></div>
      `;
    }

    function renderActiveView() {
      activeState.selectedOnly = document.getElementById('selectedOnlyToggle').checked;
      activeState.minWeight = Number(document.getElementById('minWeight').value || 1);
      activeState.selectedInstitution = document.getElementById('institutionFilter').value;
      activeState.selectedDepartment = document.getElementById('departmentFilter').value;
      activeState.expertiseStatus = document.getElementById('expertiseStatusFilter').value;
      activeState.expertiseConfidence = document.getElementById('expertiseConfidenceFilter').value;
      activeState.selectedFlagship = document.getElementById('flagshipSelect').value;
      activeState.hopDepth = Number(document.getElementById('hopDepth').value || 1);
      activeState.edgeMode = 'backbone';
      updateFlagshipControls();
      renderFlagshipList();
      document.getElementById('convergencePanel').hidden = activeState.view !== 'convergence';

      if (activeState.view === 'convergence') {
        renderConvergenceOverview();
      } else if (activeState.view === 'person' && activeState.selectedPerson) {
        renderPersonNeighborhood(activeState.selectedPerson);
      } else if (activeState.view === 'connectors') {
        renderTopConnectors();
      } else if (activeState.selectedFlagship) {
        renderFlagship(activeState.selectedFlagship);
      } else if (activeState.selectedDepartment) {
        renderDepartmentNetwork(activeState.selectedDepartment);
      } else if (activeState.selectedInstitution) {
        renderInstitutionNetwork(activeState.selectedInstitution);
      } else {
        renderFlagshipOverview();
      }
      renderConnectorList();
    }

    function renderExpertiseDetails(person) {
      const hasExpertise = expertiseHasContent(person);
      const source = person.expertise_source_url
        ? `<a class="source-link" href="${escapeHtml(person.expertise_source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(person.expertise_source_type || person.expertise_source_url)}</a>`
        : escapeHtml(person.expertise_source_type || 'Not available');
      return `
        <div class="expertise-box">
          <h3>Expertise</h3>
          <div class="kv"><span>Keywords</span><span>${escapeHtml(person.expertise_keywords || 'Not available')}</span></div>
          <div class="kv"><span>Summary</span><span>${escapeHtml(person.expertise_summary || 'Not available')}</span></div>
          <div class="kv"><span>Source</span><span>${source}</span></div>
          <div class="kv"><span>Confidence</span><span>${escapeHtml(person.expertise_confidence || 'Not available')}</span></div>
          <div class="kv"><span>Last checked</span><span>${escapeHtml(person.expertise_last_checked || 'Not available')}</span></div>
          <div class="kv"><span>Origin</span><span>${escapeHtml(person.expertise_origin || (hasExpertise ? 'manual' : 'Not available'))}</span></div>
          ${person.expertise_manual_note ? `<div class="kv"><span>Manual note</span><span>${escapeHtml(person.expertise_manual_note)}</span></div>` : ''}
          <div class="expertise-actions">
            <button class="btn" type="button" data-edit-expertise="${escapeHtml(person.id)}">Add/edit expertise</button>
          </div>
          <div id="expertiseFormMount"></div>
        </div>
      `;
    }

    function renderExpertiseForm(person) {
      const mount = document.getElementById('expertiseFormMount');
      if (!mount) return;
      const edit = manualExpertiseEdits[person.id] || {};
      mount.innerHTML = `
        <div class="expertise-form">
          <div class="field">
            <label for="expertiseKeywordsInput">Expertise keywords</label>
            <input id="expertiseKeywordsInput" type="text" value="${escapeHtml(edit.expertise_keywords || person.expertise_keywords || '')}" placeholder="AI; medical imaging; implementation science">
          </div>
          <div class="field">
            <label for="expertiseSummaryInput">Expertise summary</label>
            <textarea id="expertiseSummaryInput" placeholder="Short expertise summary">${escapeHtml(edit.expertise_summary || person.expertise_summary || '')}</textarea>
          </div>
          <div class="field">
            <label for="expertiseSourceNoteInput">Source / note</label>
            <textarea id="expertiseSourceNoteInput" placeholder="Manual source, correction reason, or verification note">${escapeHtml(edit.source_note || person.expertise_manual_note || '')}</textarea>
          </div>
          <div class="row">
            <div class="field">
              <label for="expertiseConfidenceInput">Confidence</label>
              <select id="expertiseConfidenceInput">
                ${['high', 'medium', 'low', 'needs_review'].map(value => `<option value="${value}" ${(edit.confidence || person.expertise_confidence || 'needs_review') === value ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </div>
            <button class="btn primary" type="button" data-save-expertise="${escapeHtml(person.id)}">Save</button>
            <button class="btn" type="button" data-cancel-expertise>Cancel</button>
          </div>
        </div>
      `;
    }

    function saveExpertiseForm(personId) {
      const person = personsById.get(personId);
      if (!person) return;
      const edit = {
        person_id: person.id,
        person_name: person.name,
        expertise_keywords: document.getElementById('expertiseKeywordsInput')?.value.trim() || '',
        expertise_summary: document.getElementById('expertiseSummaryInput')?.value.trim() || '',
        source_note: document.getElementById('expertiseSourceNoteInput')?.value.trim() || '',
        confidence: document.getElementById('expertiseConfidenceInput')?.value || 'needs_review',
        edited_at: new Date().toISOString(),
      };
      manualExpertiseEdits[person.id] = edit;
      saveManualExpertiseEdits();
      applyManualExpertiseEdit(person, edit);
      renderActiveView();
      showPersonDetails(person);
    }

    function csvCell(value) {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function exportManualExpertiseEdits() {
      const rows = Object.values(manualExpertiseEdits);
      const columns = ['person_id', 'person_name', 'expertise_keywords', 'expertise_summary', 'source_note', 'confidence', 'edited_at'];
      const csv = [
        columns.join(','),
        ...rows.map(row => columns.map(column => csvCell(row[column] || '')).join(',')),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'manual_expertise_edits.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
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
        ${renderExpertiseDetails(person)}
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
      if (view === 'flagships' && activeState.selectedPerson) {
        if (globalSearchControl) globalSearchControl.clear(true);
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
          expertise_keywords: person.expertise_keywords,
          expertise_summary: person.expertise_summary,
          email: person.email,
        }));
      globalSearchControl = new TomSelect('#globalSearch', {
        options: personOptions,
        valueField: 'value',
        labelField: 'text',
        searchField: ['text', 'institution', 'department', 'department_group', 'expertise_keywords', 'expertise_summary', 'email'],
        maxOptions: 200,
        maxItems: 1,
        create: false,
        render: {
          option: (data, escape) => `<div><strong>${escape(data.text)}</strong><div class="subtle">${escape(data.institution)} · ${escape(data.department_group || data.department || 'Unknown')} · ${escape(data.expertise_keywords || data.email || '')}</div></div>`,
        },
        onType: value => {
          activeState.keyword = value.trim().toLowerCase();
          if (activeState.selectedPerson) activeState.selectedPerson = '';
          renderActiveView();
        },
        onChange: value => {
          if (value && personsById.has(value)) {
            activeState.keyword = '';
            activeState.selectedPerson = value;
            setView('person');
          } else if (!value) {
            activeState.selectedPerson = '';
            activeState.keyword = '';
            renderActiveView();
          }
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
      document.getElementById('departmentFilter').addEventListener('change', renderActiveView);

      document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
      document.getElementById('applyFilters').addEventListener('click', renderActiveView);
      document.getElementById('fitNetwork').addEventListener('click', () => network.fit({ animation: true }));
      document.getElementById('resetView').addEventListener('click', () => {
        document.getElementById('selectedOnlyToggle').checked = false;
        document.getElementById('flagshipSelect').value = '';
        document.getElementById('institutionFilter').value = '';
        document.getElementById('departmentFilter').value = '';
        document.getElementById('expertiseStatusFilter').value = '';
        document.getElementById('expertiseConfidenceFilter').value = '';
        document.getElementById('minWeight').value = '1';
        document.getElementById('hopDepth').value = '1';
        if (globalSearchControl) globalSearchControl.clear(true);
        activeState.selectedPerson = '';
        activeState.keyword = '';
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
        if (activeState.view === 'convergence') {
          renderActiveView();
          return;
        }
        activeState.selectedFlagship = '';
        activeState.flagshipFocusPerson = '';
        updateFlagshipControls();
        setView('flagships');
      });
      document.getElementById('institutionFilter').addEventListener('change', renderActiveView);
      document.getElementById('expertiseStatusFilter').addEventListener('change', renderActiveView);
      document.getElementById('expertiseConfidenceFilter').addEventListener('change', renderActiveView);
      document.getElementById('minWeight').addEventListener('change', renderActiveView);
      document.getElementById('hopDepth').addEventListener('change', renderActiveView);
      document.getElementById('exportExpertiseEdits').addEventListener('click', exportManualExpertiseEdits);

      document.addEventListener('click', event => {
        const editExpertiseItem = event.target.closest('[data-edit-expertise]');
        if (editExpertiseItem) {
          renderExpertiseForm(personsById.get(editExpertiseItem.dataset.editExpertise));
          return;
        }
        const saveExpertiseItem = event.target.closest('[data-save-expertise]');
        if (saveExpertiseItem) {
          saveExpertiseForm(saveExpertiseItem.dataset.saveExpertise);
          return;
        }
        if (event.target.closest('[data-cancel-expertise]')) {
          const mount = document.getElementById('expertiseFormMount');
          if (mount) mount.innerHTML = '';
          return;
        }
        const convergenceItem = event.target.closest('[data-convergence-flagship]');
        if (convergenceItem) {
          const flagshipId = convergenceItem.dataset.convergenceFlagship;
          setView('convergence');
          showConvergenceFlagshipDetails(flagshipId);
          return;
        }
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
          activeState.keyword = '';
          if (globalSearchControl) globalSearchControl.setValue(activeState.selectedPerson, true);
          setView('person');
        }
      });
    }

    network.on('click', params => {
      if (!params.nodes.length && params.edges.length) {
        const selectedEdge = activeState.currentEdges.find(edge => edge.id === params.edges[0]);
        if (selectedEdge?.kind === 'convergence-flagship-link') {
          showConvergenceEdgeDetails(selectedEdge.raw);
        }
        return;
      }
      if (!params.nodes.length) return;
      const id = params.nodes[0];
      if (activeState.view === 'convergence' && convergenceProfilesById.has(id)) {
        showConvergenceFlagshipDetails(id);
      } else if (flagshipsById.has(id)) {
        document.getElementById('flagshipSelect').value = id;
        activeState.selectedFlagship = id;
        activeState.flagshipFocusPerson = '';
        renderFlagship(id);
      } else if (personsById.has(id)) {
        if (activeState.view === 'person' || activeState.view === 'connectors' || (activeState.view === 'flagships' && (activeState.selectedDepartment || activeState.selectedInstitution) && !activeState.selectedFlagship)) {
          openPersonNetwork(id);
          hidePersonTooltip();
        } else if (activeState.view === 'flagships' && activeState.selectedFlagship) {
          activeState.flagshipFocusPerson = id;
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
      const node = activeState.currentNodes.find(item => item.id === nodeId);
      if (node) {
        network.body.data.nodes.update({
          id: nodeId,
          label: person.name,
          color: node.color,
          group: node.group,
          size: node.size,
          value: node.value,
          kind: node.kind,
        });
      } else {
        network.body.data.nodes.update({ id: nodeId, label: person.name });
      }
      showPersonTooltip(person, params.pointer?.DOM);
    });

    network.on('blurNode', params => {
      const nodeId = params.node;
      if (!personsById.has(nodeId)) return;
      restorePersonNode(nodeId);
      hidePersonTooltip();
    });

    renderFlagshipList();
    renderConnectorList();
    renderQualityPanel();
    initControls();
    renderFlagshipOverview();
