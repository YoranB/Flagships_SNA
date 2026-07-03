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
    const partnersById = new Map((DATA.partners || []).map(partner => [partner.id, partner]));
    const partnerLinksById = new Map((DATA.partner_flagship_links || []).map(link => [link.id, link]));
    const partnerLinksByFlagship = new Map();
    for (const link of DATA.partner_flagship_links || []) {
      if (!partnerLinksByFlagship.has(link.flagship_id)) partnerLinksByFlagship.set(link.flagship_id, []);
      partnerLinksByFlagship.get(link.flagship_id).push(link);
    }
    const campusData = DATA.campus || { clusters: [], projects: [], project_cluster_edges: [], cluster_overview: [], project_partner_links: [], partner_cluster_view: [], partners_by_project: {}, filters: { source_types: [], clusters: [] }, quality: {} };
    const campusProjectsById = new Map((campusData.projects || []).map(project => [project.project_id, project]));
    const campusProjectsByNodeId = new Map((campusData.projects || []).map(project => [project.id, project]));
    const campusClustersById = new Map((campusData.clusters || []).map(cluster => [cluster.id, cluster]));
    const campusEdgesById = new Map((campusData.project_cluster_edges || []).map(edge => [edge.id, edge]));
    const campusPartnerRowsByNodeId = new Map();
    for (const row of campusData.partner_cluster_view || []) {
      if (!campusPartnerRowsByNodeId.has(row.partner_node_id)) campusPartnerRowsByNodeId.set(row.partner_node_id, []);
      campusPartnerRowsByNodeId.get(row.partner_node_id).push(row);
    }
    const convergenceOverview = DATA.convergence_overview || { institution_groups: [], flagships: [], ranking: [], network_nodes: [], network_edges: [] };
    const convergenceProfilesById = new Map(convergenceOverview.flagships.map(profile => [profile.id, profile]));
    const edgesByPerson = new Map();
    let globalSearchControl = null;
    let searchRenderTimer = null;
    let networkFitTimer = null;
    let networkPhysicsTimer = null;
    let lastNetworkSignature = '';
    let viewHistory = [];
    let isRestoringHistory = false;
    const activeState = {
      view: 'flagships',
      selectedOnly: false,
      selectedFlagship: '',
      selectedPerson: '',
      flagshipFocusPerson: '',
      selectedInstitution: '',
      selectedDepartment: '',
      keyword: '',
      keywordLabel: '',
      selectedPartnerCategory: '',
      selectedPartnerCollaboration: '',
      selectedCampusSourceType: '',
      selectedCampusCluster: '',
      showCampusPartners: false,
      minWeight: 1,
      hopDepth: 1,
      edgeMode: 'backbone',
      currentNodes: [],
      currentEdges: [],
    };

    function snapshotState() {
      return {
        view: activeState.view,
        selectedOnly: Boolean(activeState.selectedOnly),
        selectedFlagship: activeState.selectedFlagship || '',
        selectedPerson: activeState.selectedPerson || '',
        flagshipFocusPerson: activeState.flagshipFocusPerson || '',
        selectedInstitution: activeState.selectedInstitution || '',
        selectedDepartment: activeState.selectedDepartment || '',
        keyword: activeState.keyword || '',
        keywordLabel: activeState.keywordLabel || '',
        selectedPartnerCategory: activeState.selectedPartnerCategory || '',
        selectedPartnerCollaboration: activeState.selectedPartnerCollaboration || '',
        selectedCampusSourceType: activeState.selectedCampusSourceType || '',
        selectedCampusCluster: activeState.selectedCampusCluster || '',
        showCampusPartners: Boolean(activeState.showCampusPartners),
        minWeight: Number(activeState.minWeight || 1),
        hopDepth: Number(activeState.hopDepth || 1),
        edgeMode: activeState.edgeMode || 'backbone',
      };
    }

    function snapshotKey(snapshot) {
      return JSON.stringify(snapshot);
    }

    function updateBackButton() {
      const button = document.getElementById('backOneStep');
      if (!button) return;
      button.disabled = viewHistory.length === 0;
      button.title = viewHistory.length ? 'Ga een stap terug' : 'Geen vorige stap';
    }

    function pushHistory() {
      if (isRestoringHistory) return;
      const snapshot = snapshotState();
      const last = viewHistory[viewHistory.length - 1];
      if (last && snapshotKey(last) === snapshotKey(snapshot)) return;
      viewHistory.push(snapshot);
      if (viewHistory.length > 50) viewHistory = viewHistory.slice(-50);
      updateBackButton();
    }

    function applySnapshotToControls(snapshot) {
      document.getElementById('selectedOnlyToggle').checked = Boolean(snapshot.selectedOnly);
      document.getElementById('flagshipSelect').value = snapshot.selectedFlagship || '';
      document.getElementById('institutionFilter').value = snapshot.selectedInstitution || '';
      document.getElementById('departmentFilter').value = snapshot.selectedDepartment || '';
      document.getElementById('campusSourceTypeFilter').value = snapshot.selectedCampusSourceType || '';
      document.getElementById('campusClusterFilter').value = snapshot.selectedCampusCluster || '';
      document.getElementById('showCampusPartnersToggle').checked = Boolean(snapshot.showCampusPartners);
      document.getElementById('partnerCategoryFilter').value = snapshot.selectedPartnerCategory || '';
      document.getElementById('partnerCollaborationFilter').value = snapshot.selectedPartnerCollaboration || '';
      document.getElementById('minWeight').value = String(snapshot.minWeight || 1);
      document.getElementById('hopDepth').value = String(snapshot.hopDepth || 1);
      if (globalSearchControl) {
        if (snapshot.selectedPerson) {
          globalSearchControl.setValue(snapshot.selectedPerson, true);
        } else {
          globalSearchControl.clear(true);
          if (snapshot.keywordLabel && typeof globalSearchControl.setTextboxValue === 'function') {
            globalSearchControl.setTextboxValue(snapshot.keywordLabel);
          }
        }
      }
    }

    function restoreState(snapshot) {
      Object.assign(activeState, snapshot);
      applySnapshotToControls(snapshot);
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === snapshot.view));
      renderActiveView();
    }

    function goBackOneStep() {
      if (!viewHistory.length) return;
      const snapshot = viewHistory.pop();
      isRestoringHistory = true;
      restoreState(snapshot);
      isRestoringHistory = false;
      updateBackButton();
    }

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
    const partnerCategoryColors = {
      'Privaat': '#0f766e',
      'Publiek / Maatschappelijk': '#b45309',
      'Unknown': '#8a8f98',
    };
    const campusSourceColors = {
      'Flagship': '#155eef',
      'Sustainable Health': '#0f766e',
    };
    const campusClusterColors = {
      'Workforce & system transformation': '#b45309',
      'AI-driven early detection, smart diagnostics & decision support': '#7c3aed',
      'Care anywhere / hybrid care': '#0369a1',
      'Precision medicine at scale & advanced therapies': '#be123c',
      'Prevention & positive health': '#4d7c0f',
    };
    const colorForPartnerCategory = (category) => partnerCategoryColors[category] || hashColor(category);
    const colorForCampusSource = (sourceType) => campusSourceColors[sourceType] || hashColor(sourceType);
    const colorForCampusCluster = (cluster) => campusClusterColors[cluster] || hashColor(cluster);
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
      pushHistory();
      activeState.selectedPerson = personId;
      activeState.keyword = '';
      activeState.keywordLabel = '';
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

    function partnerNode(partner, links, showLabel = false) {
      const categories = partner.categories && partner.categories.length ? partner.categories : ['Unknown'];
      const category = categories[0];
      const color = colorForPartnerCategory(category);
      return {
        id: partner.id,
        label: showLabel ? partner.name : '',
        title: `<b>${escapeHtml(partner.name)}</b><br>${escapeHtml(categories.join('; '))}<br>${fmt.format(links.length)} flagship link(s)`,
        value: Math.max(1, links.length),
        size: 12 + Math.min(24, Math.sqrt(Math.max(1, links.length)) * 4),
        color: {
          background: color,
          border: '#ffffff',
          highlight: { background: color, border: '#111827' },
          hover: { background: color, border: '#111827' }
        },
        font: { size: 12 },
        group: category,
        kind: 'partner',
      };
    }

    function campusProjectNode(project, showLabel = true) {
      const color = colorForCampusSource(project.source_type);
      return {
        id: project.id,
        label: showLabel ? project.project_name : '',
        title: `<b>${escapeHtml(project.project_name)}</b><br>${escapeHtml(project.source_type)}<br>${escapeHtml(project.primary_cluster)}<br>${fmt.format(project.n_people || 0)} personen`,
        value: Math.max(1, project.n_people || 1),
        size: 18 + Math.min(28, Math.sqrt(Math.max(1, project.n_people || 1)) * 3),
        shape: 'box',
        margin: 10,
        color: {
          background: color,
          border: '#ffffff',
          highlight: { background: color, border: '#111827' },
          hover: { background: color, border: '#111827' }
        },
        font: { size: 12, color: '#ffffff', strokeWidth: 0 },
        group: project.source_type,
        kind: 'campus-project',
      };
    }

    function campusClusterNode(cluster) {
      const color = colorForCampusCluster(cluster.name);
      return {
        id: cluster.id,
        label: cluster.name,
        title: `<b>${escapeHtml(cluster.name)}</b><br>${fmt.format(cluster.n_projects)} project/programme item(s)`,
        value: Math.max(1, cluster.n_projects || 1),
        size: 24 + Math.min(24, Math.sqrt(Math.max(1, cluster.n_projects || 1)) * 5),
        color: {
          background: color,
          border: '#ffffff',
          highlight: { background: color, border: '#111827' },
          hover: { background: color, border: '#111827' }
        },
        font: { size: 13 },
        group: 'Thematic cluster',
        kind: 'campus-cluster',
      };
    }

    function campusPartnerNode(row, rows, showLabel = false) {
      const color = colorForPartnerCategory(row.partner_type || 'other/unknown');
      return {
        id: row.partner_node_id,
        label: showLabel ? row.partner_name : '',
        title: `<b>${escapeHtml(row.partner_name)}</b><br>${escapeHtml(row.partner_type || 'other/unknown')}<br>${fmt.format(rows.length)} campus project link(s)`,
        value: Math.max(1, rows.length),
        size: 11 + Math.min(18, Math.sqrt(Math.max(1, rows.length)) * 4),
        color: {
          background: color,
          border: '#ffffff',
          highlight: { background: color, border: '#111827' },
          hover: { background: color, border: '#111827' }
        },
        font: { size: 11 },
        group: row.partner_type || 'other/unknown',
        kind: 'campus-partner',
        partner_type: row.partner_type || 'other/unknown',
        source: row.source || '',
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

    function countValues(values) {
      const counts = new Map();
      for (const value of values) {
        if (!value) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function passesPartnerFilters(link) {
      const categoryOk = !activeState.selectedPartnerCategory || link.partner_category === activeState.selectedPartnerCategory;
      const collaborationOk = !activeState.selectedPartnerCollaboration || (link.collaboration_types || []).includes(activeState.selectedPartnerCollaboration);
      return categoryOk && collaborationOk;
    }

    function partnerLinksForFlagship(flagship) {
      return flagshipMemberIds(flagship)
        .flatMap(flagshipId => partnerLinksByFlagship.get(flagshipId) || [])
        .filter(passesPartnerFilters);
    }

    function partnerLinksForDisplayFlagships(flagships) {
      const rows = [];
      for (const flagship of flagships) {
        for (const link of partnerLinksForFlagship(flagship)) {
          rows.push({ displayFlagship: flagship, link });
        }
      }
      return rows;
    }

    function passCampusProjectFilters(project) {
      const sourceOk = !activeState.selectedCampusSourceType || project.source_type === activeState.selectedCampusSourceType;
      const clusterOk = !activeState.selectedCampusCluster || project.primary_cluster === activeState.selectedCampusCluster;
      return sourceOk && clusterOk;
    }

    function campusPartnersForProject(project) {
      return ((campusData.partners_by_project || {})[project.project_id]?.links || []);
    }

    function campusPartnerRowsForProjects(projects) {
      const projectIds = new Set(projects.map(project => project.project_id));
      return (campusData.partner_cluster_view || []).filter(row => projectIds.has(row.project_id));
    }

    function campusPartnerTypeCounts(rows) {
      return countValues(rows.map(row => row.partner_type || 'other/unknown'));
    }

    function campusUniquePartnerRows(rows) {
      const seen = new Set();
      const unique = [];
      for (const row of rows) {
        const key = row.partner_key || row.partner_node_id || row.partner_name;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(row);
      }
      return unique;
    }

    function campusTopPartnerRows(rows, limit = 8) {
      const byPartner = new Map();
      for (const row of rows) {
        const key = row.partner_key || row.partner_node_id || row.partner_name;
        if (!key) continue;
        if (!byPartner.has(key)) byPartner.set(key, { row, count: 0 });
        byPartner.get(key).count += 1;
      }
      return [...byPartner.values()]
        .sort((a, b) => b.count - a.count || a.row.partner_name.localeCompare(b.row.partner_name))
        .slice(0, limit)
        .map(item => item.row);
    }

    function campusCirclePosition(center, index, total, radius, startAngle = -Math.PI / 2) {
      if (total <= 1 || radius === 0) return { x: center.x, y: center.y };
      const angle = startAngle + (Math.PI * 2 * index / total);
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    }

    function campusRingPosition(center, index, total, baseRadius, ringSize = 24) {
      if (total <= 1) return { x: center.x + baseRadius, y: center.y };
      const ringIndex = Math.floor(index / ringSize);
      const ringStart = ringIndex * ringSize;
      const ringTotal = Math.min(ringSize, total - ringStart);
      return campusCirclePosition(center, index - ringStart, ringTotal, baseRadius + ringIndex * 110, -Math.PI / 2 + ringIndex * 0.28);
    }

    function applyCampusLayout(projectNodes, clusterNodes, partnerNodes, projects, partnerRowsByNodeId) {
      const clusterOrder = (campusData.clusters || [])
        .map(cluster => cluster.id)
        .filter(id => clusterNodes.some(node => node.id === id));
      const clusterRadius = clusterOrder.length <= 1 ? 0 : 650;
      const clusterPositions = new Map();
      clusterOrder.forEach((clusterId, index) => {
        clusterPositions.set(clusterId, campusCirclePosition({ x: 0, y: 0 }, index, clusterOrder.length, clusterRadius));
      });

      const projectNodesById = new Map(projectNodes.map(node => [node.id, node]));
      const projectsByCluster = new Map();
      for (const project of projects) {
        if (!projectsByCluster.has(project.cluster_id)) projectsByCluster.set(project.cluster_id, []);
        projectsByCluster.get(project.cluster_id).push(project);
      }
      for (const [clusterId, clusterProjects] of projectsByCluster.entries()) {
        const center = clusterPositions.get(clusterId) || { x: 0, y: 0 };
        clusterProjects
          .sort((a, b) => a.project_name.localeCompare(b.project_name))
          .forEach((project, index) => {
            const node = projectNodesById.get(project.id);
            if (!node) return;
            const position = campusRingPosition(center, index, clusterProjects.length, 125, 10);
            Object.assign(node, { x: position.x, y: position.y, fixed: { x: true, y: true }, physics: false });
          });
      }

      const partnerNodesById = new Map(partnerNodes.map(node => [node.id, node]));
      const partnersByCluster = new Map();
      for (const [partnerNodeId, rows] of partnerRowsByNodeId.entries()) {
        const clusterId = rows[0]?.cluster_id;
        if (!clusterId) continue;
        if (!partnersByCluster.has(clusterId)) partnersByCluster.set(clusterId, []);
        partnersByCluster.get(clusterId).push({ partnerNodeId, rows });
      }
      for (const [clusterId, partners] of partnersByCluster.entries()) {
        const center = clusterPositions.get(clusterId) || { x: 0, y: 0 };
        partners
          .sort((a, b) => a.rows[0].partner_name.localeCompare(b.rows[0].partner_name))
          .forEach((item, index) => {
            const node = partnerNodesById.get(item.partnerNodeId);
            if (!node) return;
            const position = campusRingPosition(center, index, partners.length, 285, 28);
            Object.assign(node, { x: position.x, y: position.y, fixed: { x: true, y: true }, physics: false });
          });
      }

      for (const node of clusterNodes) {
        const position = clusterPositions.get(node.id) || { x: 0, y: 0 };
        Object.assign(node, { x: position.x, y: position.y, fixed: { x: true, y: true }, physics: false });
      }
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

    function networkSignature(nodes, edges) {
      const nodePart = nodes
        .map(node => `${node.id}:${node.label || ''}:${node.value || ''}:${node.size || ''}:${node.group || ''}`)
        .sort()
        .join('|');
      const edgePart = edges
        .map(edge => `${edge.id || `${edge.from}--${edge.to}`}:${edge.from}:${edge.to}:${edge.width || ''}:${edge.label || ''}`)
        .sort()
        .join('|');
      return `${nodePart}::${edgePart}`;
    }

    function clearNetworkTimers() {
      if (networkFitTimer) {
        window.clearTimeout(networkFitTimer);
        networkFitTimer = null;
      }
      if (networkPhysicsTimer) {
        window.clearTimeout(networkPhysicsTimer);
        networkPhysicsTimer = null;
      }
    }

    function setNetwork(nodes, edges, title, subtitle) {
      activeState.currentNodes = nodes;
      activeState.currentEdges = edges;
      document.getElementById('viewNodes').textContent = fmt.format(nodes.length);
      document.getElementById('viewEdges').textContent = fmt.format(edges.length);
      document.getElementById('viewTitle').textContent = title;
      document.getElementById('viewSubtitle').textContent = subtitle;

      const signature = networkSignature(nodes, edges);
      if (signature === lastNetworkSignature) return;
      lastNetworkSignature = signature;
      clearNetworkTimers();

      network.setData({
        nodes: new vis.DataSet(nodes),
        edges: new vis.DataSet(edges),
      });
      network.setOptions({ physics: { enabled: true } });
      networkFitTimer = window.setTimeout(() => {
        network.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } });
        networkFitTimer = null;
      }, 120);
      networkPhysicsTimer = window.setTimeout(() => {
        network.setOptions({ physics: false });
        networkPhysicsTimer = null;
      }, 900);
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

    function passFlagshipScope(person) {
      if (!activeState.selectedFlagship) return true;
      const flagship = flagshipsById.get(activeState.selectedFlagship);
      if (!flagship) return true;
      const memberIds = flagshipMemberIds(flagship);
      return person.flagships.some(item => memberIds.includes(item.id));
    }

    function passKeywordNetworkFilters(person) {
      return passInstitution(person) && passDepartment(person) && passFlagshipScope(person) && passKeyword(person);
    }

    function sortPeopleByConnectorScore(left, right) {
      return right.betweenness - left.betweenness ||
        right.n_flagships - left.n_flagships ||
        right.weighted_degree - left.weighted_degree ||
        left.name.localeCompare(right.name);
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
        .sort(sortPeopleByConnectorScore)
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

    function renderKeywordNetwork() {
      const keyword = activeState.keywordLabel || activeState.keyword;
      const allMatches = DATA.persons
        .filter(passKeywordNetworkFilters)
        .sort(sortPeopleByConnectorScore);
      const people = allMatches.slice(0, 50);
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
      const nodes = people.map(person => personNode(person, true));
      const scopeParts = [
        activeState.selectedFlagship ? `flagship ${flagshipsById.get(activeState.selectedFlagship)?.title || activeState.selectedFlagship}` : '',
        activeState.selectedInstitution || '',
        activeState.selectedDepartment || '',
      ].filter(Boolean);
      const scope = scopeParts.length ? ` binnen ${scopeParts.join(' · ')}` : '';
      setNetwork(
        nodes,
        edges,
        `Zoekresultaten: ${keyword}`,
        `${people.length} van ${allMatches.length} matches getoond${scope}; ${edges.length} relaties met min weight ${activeState.minWeight}.`
      );
      markActiveFlagship(activeState.selectedFlagship || '');

      const topPeople = people.slice(0, 8).map(person => `
        <div class="list-item" data-person="${escapeHtml(person.id)}">
          <div class="list-item-title">${escapeHtml(person.name)}</div>
          <div class="subtle">${escapeHtml(person.institution_clean || person.institution)} · ${escapeHtml(person.department_group || 'Unknown')} · ${person.n_flagships} flagships · degree ${person.degree}</div>
        </div>
      `).join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Zoekresultaten</h3>
        <div class="kv"><span>Trefwoord</span><span>${escapeHtml(keyword)}</span></div>
        <div class="kv"><span>Matches</span><span>${fmt.format(allMatches.length)}</span></div>
        <div class="kv"><span>Getoond</span><span>${fmt.format(people.length)}</span></div>
        <div class="kv"><span>Relaties</span><span>${fmt.format(edges.length)}</span></div>
        <div class="kv"><span>Instelling</span><span>${escapeHtml(activeState.selectedInstitution || 'Alle instellingen')}</span></div>
        <div class="kv"><span>Afdeling</span><span>${escapeHtml(activeState.selectedDepartment || 'Alle afdelingen')}</span></div>
        <div class="kv"><span>Flagship</span><span>${escapeHtml(activeState.selectedFlagship ? (flagshipsById.get(activeState.selectedFlagship)?.title || activeState.selectedFlagship) : 'Alle flagships')}</span></div>
        <div class="kv"><span>Top matches</span><span>${topPeople || '-'}</span></div>
      `;
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

    function showCampusProjectDetails(projectOrId) {
      const project = typeof projectOrId === 'string' ? campusProjectsById.get(projectOrId) || campusProjectsByNodeId.get(projectOrId) : projectOrId;
      if (!project) return;
      const partners = campusPartnersForProject(project);
      const partnerRows = partners
        .slice(0, 12)
        .map(link => `
          <div class="list-item">
            <div class="list-item-title">${escapeHtml(link.partner_name)}</div>
            <div class="subtle">${escapeHtml(link.partner_type || 'other/unknown')} · ${escapeHtml(link.source || '-')} · ${escapeHtml(link.evidence_text || link.notes || '-')}</div>
          </div>
        `).join('');
      const dashboardLink = project.dashboard_id && flagshipsById.has(project.dashboard_id)
        ? `<div class="list-item" data-flagship="${escapeHtml(project.dashboard_id)}"><div class="list-item-title">Open in SNA view</div><div class="subtle">${escapeHtml(project.dashboard_id)}</div></div>`
        : '-';
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(project.project_name)}</h3>
        <div class="kv"><span>Project id</span><span>${escapeHtml(project.project_id)}</span></div>
        <div class="kv"><span>Source type</span><span>${escapeHtml(project.source_type)}</span></div>
        <div class="kv"><span>Primary cluster</span><span>${escapeHtml(project.primary_cluster)}</span></div>
        <div class="kv"><span>People</span><span>${fmt.format(project.n_people || 0)}</span></div>
        <div class="kv"><span>Partners</span><span>${fmt.format(new Set(partners.map(link => link.partner_name)).size)}</span></div>
        <div class="kv"><span>Evidence</span><span>${escapeHtml(project.evidence_text || '-')}</span></div>
        <div class="kv"><span>Notes</span><span>${escapeHtml(project.notes || '-')}</span></div>
        <div class="kv"><span>SNA link</span><span>${dashboardLink}</span></div>
        <div class="kv"><span>Partner links</span><span>${partnerRows || '-'}</span></div>
      `;
    }

    function showCampusClusterDetails(clusterOrId) {
      const cluster = typeof clusterOrId === 'string' ? campusClustersById.get(clusterOrId) : clusterOrId;
      if (!cluster) return;
      const projects = (campusData.projects || []).filter(project => project.cluster_id === cluster.id && passCampusProjectFilters(project));
      const partnerRows = campusPartnerRowsForProjects(projects);
      const uniquePartners = campusUniquePartnerRows(partnerRows);
      const partnerTypeRows = campusPartnerTypeCounts(partnerRows).map(([type, count]) => `
        <span class="chip"><span class="swatch" style="background:${colorForPartnerCategory(type)}"></span>${escapeHtml(type)}: ${fmt.format(count)}</span>
      `).join('');
      const topPartnerRows = campusTopPartnerRows(partnerRows, 8)
        .map(row => `
          <div class="list-item" data-campus-partner="${escapeHtml(row.partner_node_id)}">
            <div class="list-item-title">${escapeHtml(row.partner_name)}</div>
            <div class="subtle">${escapeHtml(row.partner_type || 'other/unknown')}</div>
          </div>
        `).join('');
      const rows = projects.map(project => `
        <div class="list-item" data-campus-project="${escapeHtml(project.project_id)}">
          <div class="list-item-title">${escapeHtml(project.project_name)}</div>
          <div class="subtle">${escapeHtml(project.source_type)} · ${fmt.format(project.n_partners || 0)} partners · ${fmt.format(project.n_people || 0)} personen</div>
        </div>
      `).join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(cluster.name)}</h3>
        <div class="kv"><span>Items</span><span>${fmt.format(projects.length)}</span></div>
        <div class="kv"><span>Flagships</span><span>${fmt.format(projects.filter(project => project.source_type === 'Flagship').length)}</span></div>
        <div class="kv"><span>Sustainable Health</span><span>${fmt.format(projects.filter(project => project.source_type === 'Sustainable Health').length)}</span></div>
        <div class="kv"><span>Unique partners</span><span>${fmt.format(uniquePartners.length)}</span></div>
        <div class="kv"><span>Partner types</span><span><div class="chips">${partnerTypeRows || '-'}</div></span></div>
        <div class="kv"><span>Top partners</span><span>${topPartnerRows || '-'}</span></div>
        <div class="kv"><span>Projecten</span><span>${rows || '-'}</span></div>
      `;
    }

    function showCampusPartnerDetails(partnerNodeId) {
      const rows = campusPartnerRowsByNodeId.get(partnerNodeId) || [];
      if (!rows.length) return;
      const first = rows[0];
      const projectRows = rows
        .sort((a, b) => a.primary_cluster.localeCompare(b.primary_cluster) || a.project_name.localeCompare(b.project_name))
        .map(row => `
          <div class="list-item" data-campus-project="${escapeHtml(row.project_id)}">
            <div class="list-item-title">${escapeHtml(row.project_name)}</div>
            <div class="subtle">${escapeHtml(row.source_type)} · ${escapeHtml(row.primary_cluster)} · ${escapeHtml(row.source || '-')}</div>
          </div>
        `).join('');
      const typeRows = campusPartnerTypeCounts(rows).map(([type, count]) => `${escapeHtml(type)}: ${fmt.format(count)}`).join('<br>');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(first.partner_name)}</h3>
        <div class="kv"><span>Partner type</span><span>${typeRows || escapeHtml(first.partner_type || 'other/unknown')}</span></div>
        <div class="kv"><span>Project links</span><span>${fmt.format(rows.length)}</span></div>
        <div class="kv"><span>Projects</span><span>${projectRows || '-'}</span></div>
      `;
    }

    function showCampusEdgeDetails(edgeOrId) {
      const edge = typeof edgeOrId === 'string' ? campusEdgesById.get(edgeOrId) : edgeOrId;
      if (!edge) return;
      const project = campusProjectsByNodeId.get(edge.source);
      const cluster = campusClustersById.get(edge.target);
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Project-to-cluster</h3>
        <div class="kv"><span>Project</span><span>${escapeHtml(project?.project_name || edge.source)}</span></div>
        <div class="kv"><span>Cluster</span><span>${escapeHtml(cluster?.name || edge.target)}</span></div>
        <div class="kv"><span>Edge type</span><span>${escapeHtml(edge.edge_type || 'project_to_cluster')}</span></div>
        <div class="kv"><span>Source type</span><span>${escapeHtml(edge.source_type || project?.source_type || '-')}</span></div>
        <div class="kv"><span>Evidence</span><span>${escapeHtml(edge.evidence_text || project?.evidence_text || '-')}</span></div>
      `;
    }

    function showCampusPartnerEdgeDetails(row) {
      if (!row) return;
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Project-to-partner</h3>
        <div class="kv"><span>Project</span><span>${escapeHtml(row.project_name || row.project_id)}</span></div>
        <div class="kv"><span>Partner</span><span>${escapeHtml(row.partner_name || '-')}</span></div>
        <div class="kv"><span>Partner type</span><span>${escapeHtml(row.partner_type || 'other/unknown')}</span></div>
        <div class="kv"><span>Cluster</span><span>${escapeHtml(row.primary_cluster || '-')}</span></div>
        <div class="kv"><span>Edge type</span><span>project_to_partner</span></div>
        <div class="kv"><span>Source type</span><span>${escapeHtml(row.source_type || '-')}</span></div>
        <div class="kv"><span>Source</span><span>${escapeHtml(row.source || '-')}</span></div>
        <div class="kv"><span>Evidence</span><span>${escapeHtml(row.evidence_text || row.notes || '-')}</span></div>
      `;
    }

    function renderCampusOverview() {
      const projects = (campusData.projects || []).filter(passCampusProjectFilters);

      const projectIds = new Set(projects.map(project => project.id));
      const clusterIds = new Set(projects.map(project => project.cluster_id));
      const projectNodes = projects.map(project => campusProjectNode(project, true));
      const clusterNodes = (campusData.clusters || []).filter(cluster => clusterIds.has(cluster.id)).map(campusClusterNode);
      const projectClusterEdges = (campusData.project_cluster_edges || [])
        .filter(edge => projectIds.has(edge.source) && clusterIds.has(edge.target))
        .map(edge => ({
          id: edge.id,
          from: edge.source,
          to: edge.target,
          width: 2.2,
          color: { color: '#667085', highlight: '#155eef', hover: '#155eef' },
          dashes: false,
          title: `${escapeHtml(edge.source_type)}<br>${escapeHtml(edge.evidence_text)}`,
          kind: 'campus-project-cluster-link',
          raw: edge,
        }));
      const visibleProjectIds = new Set(projects.map(project => project.project_id));
      const visibleProjectById = new Map(projects.map(project => [project.project_id, project]));
      const visiblePartnerRows = activeState.showCampusPartners
        ? (campusData.partner_cluster_view || []).filter(row => visibleProjectIds.has(row.project_id))
        : [];
      const partnerRowsByNodeId = new Map();
      for (const row of visiblePartnerRows) {
        if (!partnerRowsByNodeId.has(row.partner_node_id)) partnerRowsByNodeId.set(row.partner_node_id, []);
        partnerRowsByNodeId.get(row.partner_node_id).push(row);
      }
      const showPartnerLabels = Boolean(activeState.selectedCampusCluster);
      const partnerNodes = [...partnerRowsByNodeId.values()].map(rows => campusPartnerNode(rows[0], rows, showPartnerLabels));
      const partnerEdges = visiblePartnerRows.map((row, idx) => {
        const project = visibleProjectById.get(row.project_id);
        return {
          id: `campus-project-partner:${row.project_id}:${row.partner_node_id}:${row.source_link_id || idx}`,
          from: project?.id || `campus-project:${row.project_id}`,
          to: row.partner_node_id,
          width: 0.7,
          color: { color: '#d9e2f1', highlight: '#155eef', hover: '#155eef' },
          dashes: true,
          title: `${escapeHtml(row.project_name)}<br>${escapeHtml(row.partner_type || 'other/unknown')}<br>${escapeHtml(row.evidence_text || row.notes || '-')}`,
          kind: 'campus-project-partner-link',
          edge_type: 'project_to_partner',
          source_type: row.source_type,
          raw: row,
        };
      });
      const edges = [...projectClusterEdges, ...partnerEdges];
      applyCampusLayout(projectNodes, clusterNodes, partnerNodes, projects, partnerRowsByNodeId);
      const filters = [activeState.selectedCampusSourceType, activeState.selectedCampusCluster].filter(Boolean);
      const suffix = filters.length ? ` Filter: ${filters.join(' · ')}.` : '';
      setNetwork(
        [...projectNodes, ...clusterNodes, ...partnerNodes],
        edges,
        'HealthTech Campus ecosystem',
        `${projectNodes.length} project/programme nodes, ${clusterNodes.length} thematic cluster nodes, ${partnerNodes.length} partner nodes, ${projectClusterEdges.length} project-to-cluster links, ${partnerEdges.length} project-to-partner links.${suffix}`
      );
      markActiveFlagship('');
      const sourceCounts = countValues(projects.map(project => project.source_type)).map(([source, count]) => `${escapeHtml(source)}: ${fmt.format(count)}`).join('<br>');
      const visibleUniquePartners = campusUniquePartnerRows(visiblePartnerRows);
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Campus ecosystem</h3>
        <div class="kv"><span>Projecten</span><span>${fmt.format(projects.length)}</span></div>
        <div class="kv"><span>Clusters</span><span>${fmt.format(clusterIds.size)}</span></div>
        <div class="kv"><span>Source types</span><span>${sourceCounts || '-'}</span></div>
        <div class="kv"><span>Visible partners</span><span>${fmt.format(visibleUniquePartners.length)}</span></div>
        <div class="kv"><span>Visible partner links</span><span>${fmt.format(visiblePartnerRows.length)}</span></div>
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

    function partnerFlagshipNode(flagship, linkCount) {
      return {
        id: flagship.id,
        label: flagship.title.length > 34 ? flagship.title.slice(0, 31) + '...' : flagship.title,
        title: `<b>${escapeHtml(flagship.title)}</b><br>${fmt.format(linkCount)} partner link(s)`,
        value: Math.max(1, linkCount),
        size: 16 + Math.min(30, Math.sqrt(Math.max(1, linkCount)) * 4),
        color: {
          background: '#155eef',
          border: '#ffffff',
          highlight: { background: '#174ea6', border: '#ffffff' },
          hover: { background: '#174ea6', border: '#ffffff' }
        },
        font: { size: 12 },
        kind: 'partner-flagship',
      };
    }

    function renderPartnerEcosystem() {
      const allFlagships = visibleFlagships();
      const displayFlagships = activeState.selectedFlagship
        ? allFlagships.filter(flagship => flagship.id === activeState.selectedFlagship)
        : allFlagships;
      const rows = partnerLinksForDisplayFlagships(displayFlagships);
      const linksByDisplayFlagship = new Map();
      const linksByPartner = new Map();

      for (const row of rows) {
        const flagshipId = row.displayFlagship.id;
        if (!linksByDisplayFlagship.has(flagshipId)) linksByDisplayFlagship.set(flagshipId, []);
        linksByDisplayFlagship.get(flagshipId).push(row.link);
        if (!linksByPartner.has(row.link.partner_id)) linksByPartner.set(row.link.partner_id, []);
        linksByPartner.get(row.link.partner_id).push(row.link);
      }

      const flagshipNodes = displayFlagships
        .filter(flagship => activeState.selectedFlagship || linksByDisplayFlagship.has(flagship.id))
        .map(flagship => partnerFlagshipNode(flagship, linksByDisplayFlagship.get(flagship.id)?.length || 0));
      const partnerNodes = [...linksByPartner.entries()]
        .map(([partnerId, links]) => partnersById.has(partnerId) ? partnerNode(partnersById.get(partnerId), links, links.length > 1) : null)
        .filter(Boolean);
      const edges = rows.map(row => ({
        id: `partner-edge:${row.displayFlagship.id}:${row.link.id}`,
        from: row.displayFlagship.id,
        to: row.link.partner_id,
        width: 1.2,
        color: { color: '#98a2b3', highlight: '#155eef', hover: '#155eef' },
        title: `${escapeHtml(row.displayFlagship.title)} ↔ ${escapeHtml(row.link.partner_name)}<br>${escapeHtml(row.link.partner_category)}<br>${escapeHtml((row.link.collaboration_types || []).join('; '))}`,
        kind: 'partner-flagship-link',
        raw: row.link,
        displayFlagshipId: row.displayFlagship.id,
      }));

      const filters = [
        activeState.selectedPartnerCategory,
        activeState.selectedPartnerCollaboration,
        activeState.selectedFlagship ? (flagshipsById.get(activeState.selectedFlagship)?.title || activeState.selectedFlagship) : '',
      ].filter(Boolean);
      const suffix = filters.length ? ` Filter: ${filters.join(' · ')}.` : '';
      setNetwork(
        [...flagshipNodes, ...partnerNodes],
        edges,
        'Partner Ecosystem',
        `${flagshipNodes.length} flagship nodes, ${partnerNodes.length} partner nodes, ${edges.length} partner-flagship links.${suffix}`
      );
      markActiveFlagship(activeState.selectedFlagship || '');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Partner Ecosystem</h3>
        <div class="kv"><span>Partners</span><span>${fmt.format(partnerNodes.length)}</span></div>
        <div class="kv"><span>Flagships</span><span>${fmt.format(flagshipNodes.length)}</span></div>
        <div class="kv"><span>Links</span><span>${fmt.format(edges.length)}</span></div>
        <div class="kv"><span>Categorie</span><span>${escapeHtml(activeState.selectedPartnerCategory || 'Alle categorieen')}</span></div>
        <div class="kv"><span>Samenwerking</span><span>${escapeHtml(activeState.selectedPartnerCollaboration || 'Alle typen')}</span></div>
      `;
    }

    function renderPartnerLinkList(links) {
      return links.map(link => `
        <div class="list-item" data-partner-link="${escapeHtml(link.id)}">
          <div class="list-item-title">${escapeHtml(link.flagship_title || link.flagship_id)}</div>
          <div class="subtle">${escapeHtml(link.partner_category)} · ${escapeHtml((link.collaboration_types || []).join('; ') || link.collaboration_type_raw || '-')}</div>
        </div>
      `).join('');
    }

    function showPartnerDetails(partnerId) {
      const partner = partnersById.get(partnerId);
      if (!partner) return;
      const links = (partner.link_ids || []).map(id => partnerLinksById.get(id)).filter(Boolean).filter(passesPartnerFilters);
      const categoryChips = (partner.categories || []).map(category => `
        <span class="chip"><span class="swatch" style="background:${colorForPartnerCategory(category)}"></span>${escapeHtml(category)}</span>
      `).join('');
      const typeChips = countValues(links.flatMap(link => link.collaboration_types || [])).map(([type, count]) => `
        <span class="chip">${escapeHtml(type)}: ${fmt.format(count)}</span>
      `).join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(partner.name)}</h3>
        <div class="kv"><span>Flagships</span><span>${fmt.format(new Set(links.map(link => link.flagship_id)).size)}</span></div>
        <div class="kv"><span>Links</span><span>${fmt.format(links.length)}</span></div>
        <div class="chips">${categoryChips || '<span class="chip">Unknown</span>'}</div>
        <div class="chips">${typeChips || '<span class="chip">Geen type</span>'}</div>
        <div class="kv"><span>Records</span><span>${renderPartnerLinkList(links) || '-'}</span></div>
      `;
    }

    function showPartnerEdgeDetails(linkOrId) {
      const link = typeof linkOrId === 'string' ? partnerLinksById.get(linkOrId) : linkOrId;
      if (!link) return;
      const years = [link.start_year || '', link.end_year || ''].filter(Boolean).join(' - ') || '-';
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(link.partner_name)}</h3>
        <div class="kv"><span>Flagship</span><span>${escapeHtml(link.flagship_title || link.flagship_id)}</span></div>
        <div class="kv"><span>Categorie</span><span>${escapeHtml(link.partner_category)}</span></div>
        ${link.partner_category_raw && link.partner_category_raw !== link.partner_category ? `<div class="kv"><span>Categorie ruw</span><span>${escapeHtml(link.partner_category_raw)}</span></div>` : ''}
        <div class="kv"><span>Samenwerking</span><span>${escapeHtml((link.collaboration_types || []).join('; ') || '-')}</span></div>
        <div class="kv"><span>Type ruw</span><span>${escapeHtml(link.collaboration_type_raw || '-')}</span></div>
        <div class="kv"><span>Periode</span><span>${escapeHtml(link.reporting_period || '-')}</span></div>
        <div class="kv"><span>Jaren</span><span>${escapeHtml(years)}</span></div>
        <div class="kv"><span>Rol</span><span>${escapeHtml(link.role_relevance || '-')}</span></div>
      `;
    }

    function renderActiveView() {
      activeState.selectedOnly = document.getElementById('selectedOnlyToggle').checked;
      activeState.minWeight = Number(document.getElementById('minWeight').value || 1);
      activeState.selectedInstitution = document.getElementById('institutionFilter').value;
      activeState.selectedDepartment = document.getElementById('departmentFilter').value;
      activeState.selectedPartnerCategory = document.getElementById('partnerCategoryFilter').value;
      activeState.selectedPartnerCollaboration = document.getElementById('partnerCollaborationFilter').value;
      activeState.selectedCampusSourceType = document.getElementById('campusSourceTypeFilter').value;
      activeState.selectedCampusCluster = document.getElementById('campusClusterFilter').value;
      activeState.showCampusPartners = document.getElementById('showCampusPartnersToggle').checked;
      activeState.selectedFlagship = document.getElementById('flagshipSelect').value;
      activeState.hopDepth = Number(document.getElementById('hopDepth').value || 1);
      activeState.edgeMode = 'backbone';
      updateFlagshipControls();
      renderFlagshipList();
      document.getElementById('convergencePanel').hidden = true;
      if (activeState.view === 'convergence') {
        document.getElementById('convergencePanel').hidden = false;
      }

      if (activeState.view === 'convergence') {
        renderConvergenceOverview();
      } else if (activeState.view === 'campus') {
        renderCampusOverview();
      } else if (activeState.view === 'partners') {
        renderPartnerEcosystem();
      } else if (activeState.view === 'person' && activeState.selectedPerson) {
        renderPersonNeighborhood(activeState.selectedPerson);
      } else if (activeState.view === 'person' && activeState.keyword) {
        renderKeywordNetwork();
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

    function renderFlagshipPartnerSummary(flagship) {
      const links = partnerLinksForFlagship(flagship);
      if (!links.length) {
        return `
          <div class="kv"><span>Partners</span><span>Geen partnerrecords</span></div>
        `;
      }
      const uniquePartners = new Map();
      for (const link of links) {
        if (!uniquePartners.has(link.partner_id)) uniquePartners.set(link.partner_id, link);
      }
      const categoryChips = countValues(links.map(link => link.partner_category)).map(([category, count]) => `
        <span class="chip"><span class="swatch" style="background:${colorForPartnerCategory(category)}"></span>${escapeHtml(category)}: ${fmt.format(count)}</span>
      `).join('');
      const typeChips = countValues(links.flatMap(link => link.collaboration_types || [])).map(([type, count]) => `
        <span class="chip">${escapeHtml(type)}: ${fmt.format(count)}</span>
      `).join('');
      const partnerRows = [...uniquePartners.values()]
        .sort((a, b) => a.partner_name.localeCompare(b.partner_name))
        .slice(0, 8)
        .map(link => `
          <div class="list-item" data-partner="${escapeHtml(link.partner_id)}">
            <div class="list-item-title">${escapeHtml(link.partner_name)}</div>
            <div class="subtle">${escapeHtml(link.partner_category)} · ${escapeHtml((link.collaboration_types || []).join('; ') || '-')}</div>
          </div>
        `).join('');
      return `
        <div class="kv"><span>Partners</span><span>${fmt.format(uniquePartners.size)} uniek · ${fmt.format(links.length)} records</span></div>
        <div class="chips">${categoryChips}</div>
        <div class="chips">${typeChips}</div>
        <div class="kv"><span>Partnerlijst</span><span>${partnerRows || '-'}</span></div>
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
        ${renderFlagshipPartnerSummary(flagship)}
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

    function renderQualityPanel() {
      const quality = DATA.quality;
      const partnerQuality = DATA.partner_quality || {};
      const campusQuality = campusData.quality || {};
      document.getElementById('qualityPanel').innerHTML = `
        <div><b>${fmt.format(quality.people)}</b> personen</div>
        <div><b>${fmt.format(quality.edges)}</b> co-applicant relaties totaal</div>
        <div><b>${fmt.format(quality.flagships)}</b> flagships</div>
        <div><b>${fmt.format(quality.placeholder_person_ids)}</b> placeholder/fallback person ids</div>
        <div><b>${fmt.format(quality.raw_institution_values)}</b> ruwe instellingwaarden → <b>${fmt.format(quality.simplified_institution_values)}</b> genormaliseerd</div>
        <div><b>${fmt.format(quality.raw_department_values || 0)}</b> ruwe afdelingen → <b>${fmt.format(quality.department_groups || 0)}</b> groepen</div>
        <div><b>${fmt.format(partnerQuality.source_rows || 0)}</b> partnerrecords → <b>${fmt.format(partnerQuality.unique_partners || 0)}</b> unieke partners</div>
        <div><b>${fmt.format((partnerQuality.matched_flagship_ids || []).length)}</b> partner-flagships gematcht; <b>${fmt.format((partnerQuality.unmatched_flagship_ids || []).length)}</b> ongematcht</div>
        <div><b>${fmt.format(campusQuality.valid_projects || 0)}</b> campusprojecten → <b>${fmt.format((campusData.clusters || []).length)}</b> clusters</div>
        <div><b>${fmt.format(campusQuality.unique_partner_cluster_partners || 0)}</b> unieke campuspartners via <b>${fmt.format(campusQuality.partner_cluster_rows || 0)}</b> project-partner-cluster rijen</div>
      `;
    }

    function markActiveFlagship(flagshipId) {
      document.querySelectorAll('[data-flagship]').forEach(item => {
        item.classList.toggle('active', item.dataset.flagship === flagshipId);
      });
    }

    function setView(view) {
      if (view !== activeState.view) pushHistory();
      activeState.view = view;
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
      if (view === 'flagships' && activeState.selectedPerson) {
        if (globalSearchControl) globalSearchControl.clear(true);
        activeState.selectedPerson = '';
      }
      renderActiveView();
    }

    function markActiveViewTab(view) {
      activeState.view = view;
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
    }

    function scheduleSearchRender() {
      if (searchRenderTimer) window.clearTimeout(searchRenderTimer);
      searchRenderTimer = window.setTimeout(() => {
        searchRenderTimer = null;
        renderActiveView();
      }, 180);
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
          const nextLabel = value.trim();
          const nextKeyword = nextLabel.toLowerCase();
          if (nextKeyword !== activeState.keyword || activeState.selectedPerson) pushHistory();
          activeState.keywordLabel = nextLabel;
          activeState.keyword = nextKeyword;
          if (activeState.selectedPerson) activeState.selectedPerson = '';
          if (activeState.keyword) {
            markActiveViewTab('person');
          } else if (activeState.view === 'person') {
            markActiveViewTab('flagships');
          }
          scheduleSearchRender();
        },
        onChange: value => {
          if (searchRenderTimer) {
            window.clearTimeout(searchRenderTimer);
            searchRenderTimer = null;
          }
          if (value && personsById.has(value)) {
            pushHistory();
            activeState.keyword = '';
            activeState.keywordLabel = '';
            activeState.selectedPerson = value;
            setView('person');
          } else if (!value) {
            if (activeState.selectedPerson || activeState.keyword) pushHistory();
            activeState.selectedPerson = '';
            activeState.keyword = '';
            activeState.keywordLabel = '';
            if (activeState.view === 'person') markActiveViewTab('flagships');
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

      const partnerFilters = DATA.partner_filters || { categories: [], collaboration_types: [] };
      document.getElementById('partnerCategoryFilter').innerHTML =
        '<option value="">Alle partnercategorieen</option>' +
        (partnerFilters.categories || []).map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
      document.getElementById('partnerCollaborationFilter').innerHTML =
        '<option value="">Alle samenwerkingstypen</option>' +
        (partnerFilters.collaboration_types || []).map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');

      const campusFilters = campusData.filters || { source_types: [], clusters: [] };
      document.getElementById('campusSourceTypeFilter').innerHTML =
        '<option value="">Alle bronsoorten</option>' +
        (campusFilters.source_types || []).map(source => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`).join('');
      document.getElementById('campusClusterFilter').innerHTML =
        '<option value="">Alle thematic clusters</option>' +
        (campusFilters.clusters || []).map(cluster => `<option value="${escapeHtml(cluster)}">${escapeHtml(cluster)}</option>`).join('');

      document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
      document.getElementById('applyFilters').addEventListener('click', () => {
        pushHistory();
        renderActiveView();
      });
      document.getElementById('fitNetwork').addEventListener('click', () => network.fit({ animation: true }));
      document.getElementById('backOneStep').addEventListener('click', goBackOneStep);
      document.getElementById('resetView').addEventListener('click', () => {
        viewHistory = [];
        updateBackButton();
        document.getElementById('selectedOnlyToggle').checked = false;
        document.getElementById('flagshipSelect').value = '';
        document.getElementById('institutionFilter').value = '';
        document.getElementById('departmentFilter').value = '';
        document.getElementById('campusSourceTypeFilter').value = '';
        document.getElementById('campusClusterFilter').value = '';
        document.getElementById('showCampusPartnersToggle').checked = false;
        document.getElementById('partnerCategoryFilter').value = '';
        document.getElementById('partnerCollaborationFilter').value = '';
        document.getElementById('minWeight').value = '1';
        document.getElementById('hopDepth').value = '1';
        if (globalSearchControl) globalSearchControl.clear(true);
        activeState.selectedPerson = '';
        activeState.keyword = '';
        activeState.keywordLabel = '';
        activeState.flagshipFocusPerson = '';
        activeState.selectedPartnerCategory = '';
        activeState.selectedPartnerCollaboration = '';
        activeState.selectedCampusSourceType = '';
        activeState.selectedCampusCluster = '';
        activeState.showCampusPartners = false;
        isRestoringHistory = true;
        setView('flagships');
        isRestoringHistory = false;
        updateBackButton();
      });
      document.getElementById('flagshipSelect').addEventListener('change', event => {
        pushHistory();
        activeState.selectedFlagship = event.target.value;
        activeState.flagshipFocusPerson = '';
        if (activeState.view === 'partners') {
          renderActiveView();
          return;
        }
        if (activeState.keyword) {
          markActiveViewTab('person');
          renderActiveView();
          return;
        }
        setView('flagships');
      });
      document.getElementById('selectedOnlyToggle').addEventListener('change', () => {
        pushHistory();
        activeState.selectedOnly = document.getElementById('selectedOnlyToggle').checked;
        if (activeState.view === 'convergence' || activeState.view === 'partners' || activeState.view === 'campus') {
          renderActiveView();
          return;
        }
        activeState.selectedFlagship = '';
        activeState.flagshipFocusPerson = '';
        updateFlagshipControls();
        setView('flagships');
      });
      document.getElementById('institutionFilter').addEventListener('change', () => {
        pushHistory();
        renderActiveView();
      });
      document.getElementById('departmentFilter').addEventListener('change', () => {
        pushHistory();
        renderActiveView();
      });
      document.getElementById('partnerCategoryFilter').addEventListener('change', () => {
        pushHistory();
        markActiveViewTab('partners');
        renderActiveView();
      });
      document.getElementById('partnerCollaborationFilter').addEventListener('change', () => {
        pushHistory();
        markActiveViewTab('partners');
        renderActiveView();
      });
      document.getElementById('campusSourceTypeFilter').addEventListener('change', () => {
        pushHistory();
        markActiveViewTab('campus');
        renderActiveView();
      });
      document.getElementById('campusClusterFilter').addEventListener('change', () => {
        pushHistory();
        markActiveViewTab('campus');
        renderActiveView();
      });
      document.getElementById('showCampusPartnersToggle').addEventListener('change', () => {
        pushHistory();
        markActiveViewTab('campus');
        renderActiveView();
      });
      document.getElementById('minWeight').addEventListener('change', () => {
        pushHistory();
        renderActiveView();
      });
      document.getElementById('hopDepth').addEventListener('change', () => {
        pushHistory();
        renderActiveView();
      });
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
          pushHistory();
          setView('convergence');
          showConvergenceFlagshipDetails(flagshipId);
          return;
        }
        const campusProjectItem = event.target.closest('[data-campus-project]');
        if (campusProjectItem) {
          pushHistory();
          markActiveViewTab('campus');
          showCampusProjectDetails(campusProjectItem.dataset.campusProject);
          return;
        }
        const campusClusterItem = event.target.closest('[data-campus-cluster]');
        if (campusClusterItem) {
          pushHistory();
          markActiveViewTab('campus');
          showCampusClusterDetails(campusClusterItem.dataset.campusCluster);
          return;
        }
        const campusPartnerItem = event.target.closest('[data-campus-partner]');
        if (campusPartnerItem) {
          pushHistory();
          markActiveViewTab('campus');
          showCampusPartnerDetails(campusPartnerItem.dataset.campusPartner);
          return;
        }
        const partnerLinkItem = event.target.closest('[data-partner-link]');
        if (partnerLinkItem) {
          pushHistory();
          markActiveViewTab('partners');
          showPartnerEdgeDetails(partnerLinkItem.dataset.partnerLink);
          return;
        }
        const partnerItem = event.target.closest('[data-partner]');
        if (partnerItem) {
          pushHistory();
          markActiveViewTab('partners');
          showPartnerDetails(partnerItem.dataset.partner);
          return;
        }
        const flagshipItem = event.target.closest('[data-flagship]');
        if (flagshipItem) {
          pushHistory();
          document.getElementById('flagshipSelect').value = flagshipItem.dataset.flagship;
          activeState.selectedFlagship = flagshipItem.dataset.flagship;
          activeState.flagshipFocusPerson = '';
          if (activeState.keyword) {
            markActiveViewTab('person');
            renderActiveView();
            return;
          }
          setView('flagships');
          return;
        }
        const personItem = event.target.closest('[data-person]');
        if (personItem) {
          pushHistory();
          activeState.selectedPerson = personItem.dataset.person;
          activeState.keyword = '';
          activeState.keywordLabel = '';
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
        } else if (selectedEdge?.kind === 'campus-project-cluster-link') {
          showCampusEdgeDetails(selectedEdge.raw);
        } else if (selectedEdge?.kind === 'campus-project-partner-link') {
          showCampusPartnerEdgeDetails(selectedEdge.raw);
        } else if (selectedEdge?.kind === 'partner-flagship-link') {
          showPartnerEdgeDetails(selectedEdge.raw);
        }
        return;
      }
      if (!params.nodes.length) return;
      const id = params.nodes[0];
      if (activeState.view === 'partners' && partnersById.has(id)) {
        showPartnerDetails(id);
      } else if (activeState.view === 'campus' && campusProjectsByNodeId.has(id)) {
        showCampusProjectDetails(id);
      } else if (activeState.view === 'campus' && campusClustersById.has(id)) {
        showCampusClusterDetails(id);
      } else if (activeState.view === 'campus' && campusPartnerRowsByNodeId.has(id)) {
        showCampusPartnerDetails(id);
      } else if (activeState.view === 'partners' && flagshipsById.has(id)) {
        pushHistory();
        document.getElementById('flagshipSelect').value = id;
        activeState.selectedFlagship = id;
        renderPartnerEcosystem();
        showFlagshipDetails(flagshipsById.get(id));
      } else if (activeState.view === 'convergence' && convergenceProfilesById.has(id)) {
        showConvergenceFlagshipDetails(id);
      } else if (flagshipsById.has(id)) {
        pushHistory();
        document.getElementById('flagshipSelect').value = id;
        activeState.selectedFlagship = id;
        activeState.flagshipFocusPerson = '';
        renderFlagship(id);
      } else if (personsById.has(id)) {
        if (activeState.view === 'person' || activeState.view === 'connectors' || (activeState.view === 'flagships' && (activeState.selectedDepartment || activeState.selectedInstitution) && !activeState.selectedFlagship)) {
          openPersonNetwork(id);
          hidePersonTooltip();
        } else if (activeState.view === 'flagships' && activeState.selectedFlagship) {
          pushHistory();
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
    renderQualityPanel();
    initControls();
    renderFlagshipOverview();
