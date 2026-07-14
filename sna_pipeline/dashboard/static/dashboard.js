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
      person.has_expertise = expertiseHasContent(person);
      person.expertise_availability = person.has_expertise ? 'available' : 'not_available';
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
    const callsById = new Map((DATA.calls || []).map(call => [call.id, call]));
    const proposalsById = new Map((DATA.proposals || []).map(proposal => [proposal.id, proposal]));
    const organisationData = DATA.organisation_participation || { records: [], institutions: [], departments: [], summary: {} };
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
    let callFilterControl = null;
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
      selectedCallIds: [],
      keyword: '',
      keywordLabel: '',
      selectedPartnerCategory: '',
      selectedPartnerCollaboration: '',
      sidebarCollapsed: false,
      minWeight: 1,
      hopDepth: 1,
      edgeMode: 'backbone',
      currentNodes: [],
      currentEdges: [],
      personScopeStats: new Map(),
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
        selectedCallIds: [...(activeState.selectedCallIds || [])],
        keyword: activeState.keyword || '',
      keywordLabel: activeState.keywordLabel || '',
      selectedPartnerCategory: activeState.selectedPartnerCategory || '',
      selectedPartnerCollaboration: activeState.selectedPartnerCollaboration || '',
      sidebarCollapsed: Boolean(activeState.sidebarCollapsed),
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

    function setSidebarCollapsed(collapsed) {
      activeState.sidebarCollapsed = Boolean(collapsed);
      const app = document.querySelector('.app');
      if (app) app.classList.toggle('sidebar-collapsed', activeState.sidebarCollapsed);
      const toggle = document.getElementById('sidebarToggle');
      if (toggle) {
        toggle.textContent = activeState.sidebarCollapsed ? 'Toon filters' : 'Verberg filters';
        toggle.setAttribute('aria-expanded', String(!activeState.sidebarCollapsed));
      }
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
      if (callFilterControl) callFilterControl.setValue(snapshot.selectedCallIds || [], true);
      document.getElementById('partnerCategoryFilter').value = snapshot.selectedPartnerCategory || '';
      document.getElementById('partnerCollaborationFilter').value = snapshot.selectedPartnerCollaboration || '';
      document.getElementById('minWeight').value = String(snapshot.minWeight || 1);
      document.getElementById('hopDepth').value = String(snapshot.hopDepth || 1);
      setSidebarCollapsed(Boolean(snapshot.sidebarCollapsed));
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
      refreshScopedControls();
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
    const MULTI_LINK_PARTNER_FILTER = '__multi_link_partners__';
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

    function splitValues(value) {
      if (Array.isArray(value)) return value.filter(Boolean);
      return String(value || '').split(';').map(item => item.trim()).filter(Boolean);
    }

    function selectedCallSet() {
      return new Set(activeState.selectedCallIds || []);
    }

    function passesCallIds(callIds) {
      const selected = selectedCallSet();
      if (!selected.size) return true;
      return splitValues(callIds).some(callId => selected.has(callId));
    }

    function passCall(person) {
      return passesCallIds((person.calls || []).map(call => call.id));
    }

    function scopedProjectContexts(person) {
      const selectedIds = selectedProposalIds();
      return (person.project_contexts || []).filter(context =>
        passesCallIds([context.call_id]) && (!selectedIds.length || selectedIds.includes(context.id))
      );
    }

    function scopedPersonFlagships(person) {
      const selectedIds = selectedProposalIds();
      return (person.flagships || []).filter(item =>
        passesCallIds([item.call_id]) && (!selectedIds.length || selectedIds.includes(item.id) || selectedIds.includes(item.proposal_key))
      );
    }

    function personInstitutionUnits(person) {
      return person.institution_units?.length ? person.institution_units : [person.institution_clean || person.institution || 'Unknown'];
    }

    function personDepartmentUnits(person) {
      return person.department_units?.length ? person.department_units : [person.department_group || 'Unknown'];
    }

    function personHasProposal(person, proposalId = activeState.selectedFlagship) {
      if (!proposalId) return true;
      const selectedIds = selectedProposalIds(proposalId);
      return (person.flagships || []).some(item => selectedIds.includes(item.id) || selectedIds.includes(item.proposal_key)) ||
        (person.project_contexts || []).some(item => selectedIds.includes(item.id));
    }

    function filteredEdgeWeight(edge) {
      const weights = edge.call_weights || {};
      const selected = selectedCallSet();
      if (!selected.size) return Number(edge.weight || 0);
      return [...selected].reduce((total, callId) => total + Number(weights[callId] || 0), 0);
    }

    function scopedEdge(edge) {
      return { ...edge, weight: filteredEdgeWeight(edge) };
    }

    function refreshPersonScopeStats() {
      const stats = new Map();
      for (const person of DATA.persons) stats.set(person.id, { degree: 0, weightedDegree: 0 });
      for (const edge of DATA.edges) {
        const weight = filteredEdgeWeight(edge);
        if (weight <= 0) continue;
        for (const personId of [edge.source, edge.target]) {
          const item = stats.get(personId) || { degree: 0, weightedDegree: 0 };
          item.degree += 1;
          item.weightedDegree += weight;
          stats.set(personId, item);
        }
      }
      activeState.personScopeStats = stats;
    }

    function callFilterLabel() {
      const selected = activeState.selectedCallIds || [];
      if (!selected.length) return DATA.calls.length === 1 ? DATA.calls[0].name : 'Alle calls';
      return selected.map(id => callsById.get(id)?.name || id).join(' + ');
    }

    function updateCallBadge() {
      const badge = document.getElementById('activeCallBadge');
      if (badge) badge.textContent = callFilterLabel();
    }

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
      const scoped = activeState.personScopeStats.get(person.id) || { degree: 0, weightedDegree: 0 };
      const size = 12 + Math.min(32, Math.sqrt(Math.max(scoped.weightedDegree, scoped.degree, 1)) * 3.2);
      const color = groupColorForPerson(person);
      const border = person.is_placeholder ? '#111827' : '#ffffff';
      return {
        id: person.id,
        label: showLabel ? person.name : '',
        value: Math.max(1, scoped.weightedDegree),
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

    function restoreCurrentNode(nodeId) {
      const node = activeState.currentNodes.find(item => item.id === nodeId);
      if (!node) return;
      network.body.data.nodes.update(node);
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
      const scoped = activeState.personScopeStats.get(person.id) || { degree: 0, weightedDegree: 0 };
      const contexts = scopedProjectContexts(person);
      return `
        <div class="tooltip-title">
          <span class="swatch" style="background:${swatch}"></span>
          <span>${escapeHtml(person.name)}</span>
        </div>
        <div class="tooltip-grid">
          <span>Instelling</span><span>${escapeHtml(person.institution_clean || person.institution || '-')}</span>
          <span>Afdeling</span><span>${escapeHtml(departmentDisplay(person))}</span>
          <span>Groep</span><span>${escapeHtml(groupLabelForPerson(person))}</span>
          <span>Degree</span><span>${fmt.format(scoped.degree)}</span>
          <span>Weighted</span><span>${fmt.format(scoped.weightedDegree)}</span>
          <span>Betweenness</span><span>${person.betweenness.toFixed(4)} (globaal)</span>
          <span>Projectcontext</span><span>${fmt.format(contexts.length)}</span>
        </div>
        <div class="tooltip-hint">Klik om details of dit persoonsnetwerk te openen.</div>
      `;
    }

    function showNetworkTooltip(html, pointer) {
      const tooltip = document.getElementById('personTooltip');
      const networkRect = document.getElementById('network').getBoundingClientRect();
      const x = networkRect.left + (pointer?.x ?? 0) + 16;
      const y = networkRect.top + (pointer?.y ?? 0) + 16;

      tooltip.innerHTML = html;
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

    function showPersonTooltip(person, pointer) {
      showNetworkTooltip(renderPersonTooltipContent(person), pointer);
    }

    function hideNetworkTooltip() {
      const tooltip = document.getElementById('personTooltip');
      tooltip.classList.remove('visible');
      tooltip.setAttribute('aria-hidden', 'true');
    }

    function hidePersonTooltip() {
      hideNetworkTooltip();
    }

    function renderCampusTooltipContent(nodeId) {
      if (campusProjectsByNodeId.has(nodeId)) {
        const project = campusProjectsByNodeId.get(nodeId);
        const partners = campusPartnersForProject(project);
        const collaborationTypes = countValues(partners.flatMap(link => link.collaboration_types || []))
          .slice(0, 4)
          .map(([type]) => type)
          .join('; ') || '-';
        return `
          <div class="tooltip-title">
            <span class="swatch" style="background:${colorForCampusSource(project.source_type)}"></span>
            <span>${escapeHtml(project.project_name)}</span>
          </div>
          <div class="tooltip-grid">
            <span>Type</span><span>${escapeHtml(project.source_type)}</span>
            <span>Cluster</span><span>${escapeHtml(project.primary_cluster)}</span>
            <span>Personen</span><span>${fmt.format(project.n_people || 0)}</span>
            <span>Partners</span><span>${fmt.format(new Set(partners.map(link => link.partner_name)).size)}</span>
            <span>Samenwerking</span><span>${escapeHtml(collaborationTypes)}</span>
          </div>
          <div class="tooltip-hint">Klik om projectdetails te openen.</div>
        `;
      }

      if (campusClustersById.has(nodeId)) {
        const cluster = campusClustersById.get(nodeId);
        return `
          <div class="tooltip-title">
            <span class="swatch" style="background:${colorForCampusCluster(cluster.name)}"></span>
            <span>${escapeHtml(cluster.name)}</span>
          </div>
          <div class="tooltip-grid">
            <span>Items</span><span>${fmt.format(cluster.n_projects || 0)}</span>
            <span>Flagships</span><span>${fmt.format(cluster.n_flagships || 0)}</span>
            <span>Sustainable Health</span><span>${fmt.format(cluster.n_sustainable_health || 0)}</span>
            <span>Partners</span><span>${fmt.format(cluster.n_unique_partners || 0)}</span>
          </div>
          <div class="tooltip-hint">Klik om clusterdetails te openen.</div>
        `;
      }

      const rows = campusPartnerRowsByNodeId.get(nodeId) || [];
      if (rows.length) {
        const first = rows[0];
        const collaborationTypes = countValues(rows.flatMap(row => row.collaboration_types || []))
          .slice(0, 4)
          .map(([type]) => type)
          .join('; ') || '-';
        return `
          <div class="tooltip-title">
            <span class="swatch" style="background:${colorForPartnerCategory(first.partner_type || 'other/unknown')}"></span>
            <span>${escapeHtml(first.partner_name)}</span>
          </div>
          <div class="tooltip-grid">
            <span>Partner type</span><span>${escapeHtml(first.partner_type || 'other/unknown')}</span>
            <span>Projectlinks</span><span>${fmt.format(rows.length)}</span>
            <span>Samenwerking</span><span>${escapeHtml(collaborationTypes)}</span>
          </div>
          <div class="tooltip-hint">Klik om partnerdetails te openen.</div>
        `;
      }

      return '';
    }

    function renderSharedFlagshipEdgeTooltip(edge, titleText, hasClickDetails = false) {
      const raw = edge.raw || edge;
      const source = convergenceProfilesById.get(raw.source) || flagshipsById.get(raw.source) || flagshipsById.get(edge.from);
      const target = convergenceProfilesById.get(raw.target) || flagshipsById.get(raw.target) || flagshipsById.get(edge.to);
      const weight = raw.weight ?? edge.value ?? edge.label ?? '-';
      const sharedPeople = Array.isArray(raw.shared_people) ? raw.shared_people.length : null;
      return `
        <div class="tooltip-title">
          <span class="swatch" style="background:#155eef"></span>
          <span>${escapeHtml(titleText)}</span>
        </div>
        <div class="tooltip-grid">
          <span>Van</span><span>${escapeHtml(source?.title || raw.source || edge.from || '-')}</span>
          <span>Naar</span><span>${escapeHtml(target?.title || raw.target || edge.to || '-')}</span>
          <span>Gedeeld</span><span>${fmt.format(Number(weight) || 0)} persoon/personen</span>
          ${sharedPeople === null ? '' : `<span>Personen</span><span>${fmt.format(sharedPeople)}</span>`}
        </div>
        ${hasClickDetails ? '<div class="tooltip-hint">Klik om details te openen.</div>' : ''}
      `;
    }

    function renderPersonEdgeTooltip(edge) {
      const raw = edge.raw || edge;
      const source = personsById.get(raw.source || edge.from);
      const target = personsById.get(raw.target || edge.to);
      const flagshipTitles = raw.flagship_titles && raw.flagship_titles.length
        ? raw.flagship_titles.join('; ')
        : (raw.flagships || []).map(id => flagshipsById.get(id)?.title || id).join('; ');
      const selected = selectedCallSet();
      const callNames = Object.keys(raw.call_weights || {})
        .filter(callId => !selected.size || selected.has(callId))
        .map(callId => callsById.get(callId)?.name || callId)
        .join('; ');
      return `
        <div class="tooltip-title">
          <span class="swatch" style="background:#98a2b3"></span>
          <span>Co-applicant relatie</span>
        </div>
        <div class="tooltip-grid">
          <span>Persoon</span><span>${escapeHtml(source?.name || raw.source || edge.from || '-')}</span>
          <span>Persoon</span><span>${escapeHtml(target?.name || raw.target || edge.to || '-')}</span>
          <span>Weight</span><span>${fmt.format(filteredEdgeWeight(raw))}</span>
          <span>Calls</span><span>${escapeHtml(callNames || '-')}</span>
          <span>Projecten</span><span>${escapeHtml(flagshipTitles || '-')}</span>
        </div>
      `;
    }

    function renderCampusEdgeTooltip(edge) {
      const raw = edge.raw || edge;
      if (edge.kind === 'campus-project-cluster-link') {
        const project = campusProjectsByNodeId.get(raw.source || edge.from);
        const cluster = campusClustersById.get(raw.target || edge.to);
        return `
          <div class="tooltip-title">
            <span class="swatch" style="background:#667085"></span>
            <span>Project-to-cluster</span>
          </div>
          <div class="tooltip-grid">
            <span>Project</span><span>${escapeHtml(project?.project_name || raw.source || edge.from || '-')}</span>
            <span>Cluster</span><span>${escapeHtml(cluster?.name || raw.target || edge.to || '-')}</span>
            <span>Source type</span><span>${escapeHtml(raw.source_type || project?.source_type || '-')}</span>
            <span>Evidence</span><span>${escapeHtml(raw.evidence_text || project?.evidence_text || '-')}</span>
          </div>
          <div class="tooltip-hint">Klik om details te openen.</div>
        `;
      }

      return `
        <div class="tooltip-title">
          <span class="swatch" style="background:${colorForPartnerCategory(raw.partner_type || 'other/unknown')}"></span>
          <span>Project-to-partner</span>
        </div>
        <div class="tooltip-grid">
          <span>Project</span><span>${escapeHtml(raw.project_name || raw.project_id || '-')}</span>
          <span>Partner</span><span>${escapeHtml(raw.partner_name || '-')}</span>
          <span>Partner type</span><span>${escapeHtml(raw.partner_type || 'other/unknown')}</span>
          <span>Samenwerking</span><span>${escapeHtml(campusCollaborationText(raw))}</span>
          <span>Evidence</span><span>${escapeHtml(raw.evidence_text || raw.notes || '-')}</span>
        </div>
        <div class="tooltip-hint">Klik om details te openen.</div>
      `;
    }

    function renderPartnerEdgeTooltip(edge) {
      const link = edge.raw || partnerLinksById.get(edge.raw?.id) || edge;
      const displayFlagship = flagshipsById.get(edge.displayFlagshipId) || flagshipsById.get(link.flagship_id);
      return `
        <div class="tooltip-title">
          <span class="swatch" style="background:${colorForPartnerCategory(link.partner_category || 'Unknown')}"></span>
          <span>Partner-link</span>
        </div>
        <div class="tooltip-grid">
          <span>Flagship</span><span>${escapeHtml(displayFlagship?.title || link.flagship_title || link.flagship_id || '-')}</span>
          <span>Partner</span><span>${escapeHtml(link.partner_name || '-')}</span>
          <span>Categorie</span><span>${escapeHtml(link.partner_category || 'Unknown')}</span>
          <span>Samenwerking</span><span>${escapeHtml((link.collaboration_types || []).join('; ') || '-')}</span>
        </div>
        <div class="tooltip-hint">Klik om details te openen.</div>
      `;
    }

    function renderEdgeTooltipContent(edge) {
      if (!edge) return '';
      if (edge.kind === 'person-edge') return renderPersonEdgeTooltip(edge);
      if (edge.kind === 'flagship-link') return renderSharedFlagshipEdgeTooltip(edge, 'Gedeelde personen');
      if (edge.kind === 'convergence-flagship-link') return renderSharedFlagshipEdgeTooltip(edge, 'Convergence link', true);
      if (edge.kind === 'campus-project-cluster-link' || edge.kind === 'campus-project-partner-link') return renderCampusEdgeTooltip(edge);
      if (edge.kind === 'partner-flagship-link') return renderPartnerEdgeTooltip(edge);
      if (edge.kind === 'call-overlap') {
        const raw = edge.raw || edge;
        return `
          <div class="tooltip-title"><span class="swatch" style="background:#7c3aed"></span><span>Gedeelde personen</span></div>
          <div class="tooltip-grid">
            <span>Van</span><span>${escapeHtml(callsById.get(raw.source)?.name || raw.source)}</span>
            <span>Naar</span><span>${escapeHtml(callsById.get(raw.target)?.name || raw.target)}</span>
            <span>Personen</span><span>${fmt.format(raw.weight || 0)}</span>
          </div>`;
      }
      return '';
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

    function callNode(call) {
      const color = hashColor(call.id);
      return {
        id: `call:${call.id}`,
        label: call.name,
        value: Math.max(1, call.n_people || 1),
        size: 24 + Math.min(38, Math.sqrt(Math.max(1, call.n_people || 1)) * 1.8),
        color: {
          background: color,
          border: '#ffffff',
          highlight: { background: color, border: '#111827' },
          hover: { background: color, border: '#111827' },
        },
        font: { size: 14 },
        kind: 'call',
        callId: call.id,
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
        value: Math.max(1, cluster.n_projects || 1),
        size: 24 + Math.min(24, Math.sqrt(Math.max(1, cluster.n_projects || 1)) * 5),
        color: {
          background: color,
          border: '#ffffff',
          highlight: { background: color, border: '#111827' },
          hover: { background: color, border: '#111827' }
        },
        font: { size: 13 },
        group: 'Cluster',
        kind: 'campus-cluster',
      };
    }

    function campusPartnerNode(row, rows, showLabel = false) {
      const color = colorForPartnerCategory(row.partner_type || 'other/unknown');
      const linkCount = Math.max(1, rows.length);
      const isMultiLink = isMultiLinkCampusPartner(rows);
      const hasPersistentLabel = Boolean(showLabel);
      const size = isMultiLink
        ? 21 + Math.min(20, Math.sqrt(linkCount) * 5)
        : 11 + Math.min(18, Math.sqrt(linkCount) * 4);
      const border = isMultiLink ? '#111827' : '#ffffff';
      return {
        id: row.partner_node_id,
        label: showLabel ? row.partner_name : '',
        value: linkCount,
        size,
        borderWidth: isMultiLink ? 3 : 1,
        color: {
          background: color,
          border,
          highlight: { background: color, border },
          hover: { background: color, border }
        },
        font: { size: hasPersistentLabel ? 16 : 11, color: '#111827', strokeWidth: hasPersistentLabel ? 5 : 3, strokeColor: '#ffffff' },
        group: row.partner_type || 'other/unknown',
        kind: 'campus-partner',
        partner_type: row.partner_type || 'other/unknown',
        source: row.source || '',
        link_count: linkCount,
        is_multi_link: isMultiLink,
      };
    }

    function edgeLabel(weight) {
      return weight > 1 ? String(weight) : '';
    }

    function edgeKey(edge) {
      return `${edge.source}--${edge.target}`;
    }

    function visibleFlagships() {
      const source = activeState.selectedOnly ? DATA.selected_flagship_groups : DATA.flagships;
      return source.filter(flagship => passesCallIds(splitValues(flagship.call_id)));
    }

    function visibleFlagshipLinks() {
      const visibleIds = new Set(visibleFlagships().map(flagship => flagship.id));
      const source = activeState.selectedOnly ? DATA.selected_flagship_links : DATA.flagship_links;
      return source.filter(link => visibleIds.has(link.source) && visibleIds.has(link.target));
    }

    function flagshipMemberIds(flagship) {
      return flagship.member_ids && flagship.member_ids.length ? flagship.member_ids : [flagship.id];
    }

    function selectedProposalIds(proposalId = activeState.selectedFlagship) {
      if (!proposalId) return [];
      const flagship = flagshipsById.get(proposalId);
      return flagship?.member_ids?.length ? flagship.member_ids : [proposalId];
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
      const categoryOk = !activeState.selectedPartnerCategory ||
        activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER ||
        link.partner_category === activeState.selectedPartnerCategory;
      const collaborationOk = !activeState.selectedPartnerCollaboration || (link.collaboration_types || []).includes(activeState.selectedPartnerCollaboration);
      return categoryOk && collaborationOk && passesCallIds([link.call_id]);
    }

    function partnerCategoryFilterLabel() {
      if (activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER) return 'Partners met meerdere links';
      return activeState.selectedPartnerCategory || 'Alle categorieen';
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
      return passesCallIds(project.call_ids || []);
    }

    function passesCampusPartnerFilters(row) {
      const categoryOk = !activeState.selectedPartnerCategory ||
        activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER ||
        row.partner_type === activeState.selectedPartnerCategory;
      const collaborationOk = !activeState.selectedPartnerCollaboration ||
        (row.collaboration_types || []).includes(activeState.selectedPartnerCollaboration);
      return categoryOk && collaborationOk && passesCallIds(row.call_ids || row.call_id || []);
    }

    function filterCampusPartnerRows(rows) {
      let filtered = rows.filter(passesCampusPartnerFilters);
      if (activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER) {
        const linkCounts = new Map();
        for (const row of filtered) {
          linkCounts.set(row.partner_node_id, (linkCounts.get(row.partner_node_id) || 0) + 1);
        }
        filtered = filtered.filter(row => linkCounts.get(row.partner_node_id) > 1);
      }
      return filtered;
    }

    function isMultiLinkCampusPartner(rows) {
      return (rows || []).length > 1;
    }

    function shouldShowCampusPartnerLabel(rows) {
      return isMultiLinkCampusPartner(rows) ||
        activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER ||
        (rows || []).some(row => row.partner_type === 'Privaat');
    }

    function campusPartnersForProject(project) {
      return ((campusData.partners_by_project || {})[project.project_id]?.links || []);
    }

    function campusPartnerRowsForProjects(projects) {
      const projectIds = new Set(projects.map(project => project.project_id));
      return filterCampusPartnerRows((campusData.partner_cluster_view || []).filter(row => projectIds.has(row.project_id)));
    }

    function campusPartnerTypeCounts(rows) {
      return countValues(rows.map(row => row.partner_type || 'other/unknown'));
    }

    function campusCollaborationText(item) {
      const types = (item.collaboration_types || []).filter(Boolean);
      return types.length ? types.join('; ') : (item.collaboration_type_raw || '-');
    }

    function campusCollaborationTypeCounts(rows) {
      return countValues(rows.flatMap(row => row.collaboration_types || []));
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
      const options = (activeState.selectedOnly ? DATA.selected_flagship_groups : DATA.proposals || [])
        .filter(proposal => passesCallIds(splitValues(proposal.call_id)))
        .map(proposal => ({
          id: proposal.id,
          title: proposal.title,
          call_name: proposal.call_name || 'Geselecteerde flagships',
        }))
        .sort((a, b) => a.call_name.localeCompare(b.call_name) || a.title.localeCompare(b.title));
      const flagshipSelect = document.getElementById('flagshipSelect');
      flagshipSelect.innerHTML = '<option value="">Alle proposals / flagships</option>' + options
        .map(proposal => `<option value="${escapeHtml(proposal.id)}">${escapeHtml(proposal.call_name + ' · ' + proposal.title)}</option>`)
        .join('');
      if (current && options.some(proposal => proposal.id === current)) {
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
      hideNetworkTooltip();
      activeState.currentNodes = nodes;
      activeState.currentEdges = edges;
      document.getElementById('viewNodes').textContent = fmt.format(nodes.length);
      document.getElementById('viewEdges').textContent = fmt.format(edges.length);
      document.getElementById('viewTitle').textContent = title;
      document.getElementById('viewSubtitle').textContent = subtitle;
      const emptyState = document.getElementById('networkEmpty');
      if (nodes.length) {
        emptyState.hidden = true;
        emptyState.textContent = '';
      } else {
        const scope = callFilterLabel();
        emptyState.textContent = selectedCallSet().size
          ? `Geen relevante of gevalideerde gegevens voor ${scope} in deze view.`
          : 'Geen gegevens voor de huidige combinatie van filters.';
        emptyState.hidden = false;
      }

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
      return !activeState.selectedInstitution || personInstitutionUnits(person).includes(activeState.selectedInstitution);
    }

    function passDepartment(person) {
      return !activeState.selectedDepartment || personDepartmentUnits(person).includes(activeState.selectedDepartment);
    }

    function passKeyword(person) {
      if (!activeState.keyword) return true;
      const contextText = scopedProjectContexts(person)
        .map(item => `${item.title} ${item.theme} ${item.role} ${item.summary}`)
        .join(' ')
        .toLowerCase();
      return `${person.base_search_text || person.search_text || ''} ${contextText}`.includes(activeState.keyword);
    }

    function passFlagshipScope(person) {
      return personHasProposal(person);
    }

    function passKeywordNetworkFilters(person) {
      return passCall(person) && passInstitution(person) && passDepartment(person) && passFlagshipScope(person) && passKeyword(person);
    }

    function sortPeopleByConnectorScore(left, right) {
      return right.betweenness - left.betweenness ||
        right.n_flagships - left.n_flagships ||
        right.weighted_degree - left.weighted_degree ||
        left.name.localeCompare(right.name);
    }

    function passPersonFilters(person) {
      return passCall(person) && passInstitution(person) && passDepartment(person) && passFlagshipScope(person) && passKeyword(person);
    }

    function passWeight(edge) {
      const weight = filteredEdgeWeight(edge);
      return weight > 0 && weight >= activeState.minWeight;
    }

    function maxEdgeCount(nodeCount) {
      const scaled = Math.round(nodeCount * 1.25);
      const smallGraphCap = nodeCount < 25 ? Math.round(nodeCount * 2) : 60;
      return Math.min(160, Math.max(nodeCount - 1, scaled, smallGraphCap));
    }

    function personEdgeWidth(edge) {
      return 0.8 + Math.min(3.5, Math.sqrt(Math.max(1, filteredEdgeWeight(edge))) * 0.8);
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
        filteredEdgeWeight(b) - filteredEdgeWeight(a) ||
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
          kind: 'flagship-link',
          raw: link,
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
          kind: 'person-edge',
          raw: edge,
        }));

      const modeLabel = activeState.edgeMode === 'all' ? 'alle edges' : activeState.edgeMode === 'selection' ? 'selectie-edges' : 'backbone';
      const focus = activeState.flagshipFocusPerson ? ` rond ${personsById.get(activeState.flagshipFocusPerson)?.name || 'selectie'}` : '';
      setNetwork(nodes, edges, flagship.title, `${visiblePeople.length} personen, ${edges.length}/${allVisibleEdges.length} relaties getoond (${modeLabel}${focus}).`);
      markActiveFlagship(flagshipId);
      showFlagshipDetails(flagship, edges.length, allVisibleEdges.length);
    }

    function renderPeopleOverview() {
      const people = DATA.persons.filter(passPersonFilters);
      const peopleIds = new Set(people.map(person => person.id));
      const allEdges = DATA.edges.filter(edge =>
        peopleIds.has(edge.source) && peopleIds.has(edge.target) && passWeight(edge)
      );
      const displayedEdges = chooseBackboneEdges(allEdges, peopleIds);
      const topIds = new Set([...people]
        .sort((left, right) => {
          const leftStats = activeState.personScopeStats.get(left.id) || { weightedDegree: 0 };
          const rightStats = activeState.personScopeStats.get(right.id) || { weightedDegree: 0 };
          return rightStats.weightedDegree - leftStats.weightedDegree || right.betweenness - left.betweenness;
        })
        .slice(0, 20)
        .map(person => person.id));
      const nodes = people.map(person => personNode(person, topIds.has(person.id)));
      const edges = displayedEdges.map(edge => ({
        id: `people:${edge.source}--${edge.target}`,
        from: edge.source,
        to: edge.target,
        width: personEdgeWidth(edge),
        label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
        kind: 'person-edge',
        raw: edge,
      }));
      setNetwork(
        nodes,
        edges,
        'People-overzicht',
        `${people.length} personen, ${edges.length}/${allEdges.length} call-gefilterde relaties getoond (${callFilterLabel()}).`
      );
      markActiveFlagship('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>People</h3>
        <div class="kv"><span>Callscope</span><span>${escapeHtml(callFilterLabel())}</span></div>
        <div class="kv"><span>Personen</span><span>${fmt.format(people.length)}</span></div>
        <div class="kv"><span>Relaties</span><span>${fmt.format(allEdges.length)}</span></div>
        <div class="kv"><span>Getoond</span><span>${fmt.format(edges.length)} backbone-relaties</span></div>
      `;
    }

    function visibleCalls() {
      return (DATA.calls || []).filter(call => passesCallIds([call.id]));
    }

    function renderCallCards(calls) {
      document.getElementById('callCards').innerHTML = calls.map(call => {
        const themes = Object.entries(call.themes || {}).slice(0, 3).map(([theme, count]) => `${theme}: ${count}`).join(' · ');
        return `
          <div class="call-card" data-call-id="${escapeHtml(call.id)}">
            <strong>${escapeHtml(call.name)}</strong>
            <span>${fmt.format(call.n_people)} personen · ${fmt.format(call.n_projects)} projecten · ${fmt.format(call.n_relationships)} relaties</span>
            <span>${fmt.format(call.n_institutions)} instellingen${themes ? ` · ${escapeHtml(themes)}` : ''}</span>
          </div>`;
      }).join('');
    }

    function renderCallQuality(calls) {
      const quality = DATA.import_quality || { totals: {}, by_call: {}, unresolved_projects: [] };
      const callIds = new Set(calls.map(call => call.id));
      const rows = calls.map(call => {
        const item = quality.by_call?.[call.id];
        if (!item) return `<div><b>${escapeHtml(call.name)}</b>: geen aparte importwaarschuwingen.</div>`;
        return `<div><b>${escapeHtml(call.name)}</b>: ${fmt.format(item.missing_email || 0)} zonder e-mail/fallback-id · ${fmt.format(item.unknown_institution || 0)} onbekende instelling · ${fmt.format(item.possible_duplicates || 0)} mogelijke duplicaten · ${fmt.format(item.institution_conflicts || 0)} instellingconflicten.</div>`;
      });
      const unresolved = (quality.unresolved_projects || [])
        .filter(project => callIds.has(project.call_id))
        .map(project => `<div class="detail-card"><b>${escapeHtml(project.title)}</b><div class="subtle">${escapeHtml(project.call_name)} · ${escapeHtml(project.issue)}</div></div>`)
        .join('');
      const totals = quality.totals || {};
      document.getElementById('callQuality').innerHTML = `
        ${rows.join('')}
        ${totals.projects ? `<div><b>${fmt.format(totals.network_projects || 0)}</b> van <b>${fmt.format(totals.projects)}</b> bronprojecten gekoppeld; <b>${fmt.format(totals.unlinked_people || 0)}</b> ongekoppelde persoon.</div>` : ''}
        ${unresolved || '<div>Geen ongekoppelde projecten binnen deze callscope.</div>'}
      `;
    }

    function renderCallsOverview() {
      const calls = visibleCalls();
      const callIds = new Set(calls.map(call => call.id));
      renderCallCards(calls);
      renderCallQuality(calls);
      const nodes = calls.map(callNode);
      const edges = (DATA.call_overlaps || [])
        .filter(edge => callIds.has(edge.source) && callIds.has(edge.target))
        .map(edge => ({
          id: `call-overlap:${edge.source}--${edge.target}`,
          from: `call:${edge.source}`,
          to: `call:${edge.target}`,
          value: edge.weight,
          width: 1 + Math.sqrt(edge.weight),
          label: edgeLabel(edge.weight),
          kind: 'call-overlap',
          raw: edge,
        }));
      setNetwork(nodes, edges, 'Callportfolio', `${calls.length} calls en ${edges.length} overlaprelaties binnen ${callFilterLabel()}.`);
      markActiveFlagship('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Callportfolio</h3>
        <div class="kv"><span>Callscope</span><span>${escapeHtml(callFilterLabel())}</span></div>
        <div class="kv"><span>Calls</span><span>${fmt.format(calls.length)}</span></div>
        <div class="kv"><span>Personen</span><span>${fmt.format(new Set(calls.flatMap(call => DATA.persons.filter(person => (person.calls || []).some(item => item.id === call.id)).map(person => person.id))).size)}</span></div>
      `;
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
          label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
          kind: 'person-edge',
          raw: edge,
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
          kind: 'person-edge',
          raw: edge,
        }));
      const nodes = people.map(person => personNode(person, true));
      setNetwork(nodes, edges, 'Top connectoren', `${people.length} personen gesorteerd op betweenness, flagships en weighted degree.`);
    }

    function scopedOrganisationRecords() {
      const selectedIds = selectedProposalIds();
      return (organisationData.records || []).filter(record =>
        passesCallIds([record.call_id]) &&
        (!selectedIds.length || selectedIds.includes(record.proposal_key)) &&
        (!activeState.selectedInstitution || record.institution === activeState.selectedInstitution) &&
        (!activeState.selectedDepartment || record.department === activeState.selectedDepartment)
      );
    }

    function aggregateOrganisationRecords(records) {
      const institutionMap = new Map();
      const departmentMap = new Map();
      const ensure = (map, key, base) => {
        if (!map.has(key)) map.set(key, { ...base, people: new Set(), departments: new Set(), proposals: new Map(), calls: new Map() });
        return map.get(key);
      };
      for (const record of records) {
        const institution = ensure(institutionMap, record.institution, { institution: record.institution });
        institution.people.add(record.person_id);
        institution.departments.add(record.department);
        institution.proposals.set(record.proposal_key, { id: record.proposal_key, title: record.proposal_title });
        institution.calls.set(record.call_id, { id: record.call_id, name: record.call_name });

        const departmentKey = `${record.institution}\u0000${record.department}`;
        const department = ensure(departmentMap, departmentKey, { institution: record.institution, department: record.department });
        department.people.add(record.person_id);
        department.proposals.set(record.proposal_key, { id: record.proposal_key, title: record.proposal_title });
        department.calls.set(record.call_id, { id: record.call_id, name: record.call_name });
      }
      const finish = item => ({
        ...item,
        n_people: item.people.size,
        n_departments: item.departments.size,
        n_proposals: item.proposals.size,
        n_calls: item.calls.size,
        person_ids: [...item.people],
        proposals: [...item.proposals.values()].sort((a, b) => a.title.localeCompare(b.title)),
        calls: [...item.calls.values()].sort((a, b) => a.name.localeCompare(b.name)),
      });
      const institutions = [...institutionMap.values()].map(finish)
        .sort((a, b) => b.n_people - a.n_people || a.institution.localeCompare(b.institution));
      const departments = [...departmentMap.values()].map(finish)
        .sort((a, b) => b.n_people - a.n_people || a.department.localeCompare(b.department));
      return {
        institutions,
        departments,
        summary: {
          n_institutions: institutions.length,
          n_departments: new Set(departments.map(item => item.department)).size,
          n_people: new Set(records.map(item => item.person_id)).size,
          n_proposals: new Set(records.map(item => item.proposal_key)).size,
          n_calls: new Set(records.map(item => item.call_id)).size,
        },
      };
    }

    function compactLinks(items, labelKey) {
      if (!items?.length) return '-';
      const visible = items.slice(0, 3).map(item => item[labelKey]);
      return `${visible.join(' · ')}${items.length > 3 ? ` · +${items.length - 3}` : ''}`;
    }

    function renderOrganisationOverview() {
      const records = scopedOrganisationRecords();
      const aggregate = aggregateOrganisationRecords(records);
      const summary = aggregate.summary;
      document.getElementById('organisationSummary').innerHTML = `
        <div class="stat"><strong>${fmt.format(summary.n_institutions)}</strong><span class="subtle">faculties / institutions</span></div>
        <div class="stat"><strong>${fmt.format(summary.n_departments)}</strong><span class="subtle">afdelingen</span></div>
        <div class="stat"><strong>${fmt.format(summary.n_people)}</strong><span class="subtle">personen</span></div>
        <div class="stat"><strong>${fmt.format(summary.n_proposals)}</strong><span class="subtle">voorstellen</span></div>
        <div class="stat"><strong>${fmt.format(summary.n_calls)}</strong><span class="subtle">calls</span></div>
      `;
      document.getElementById('institutionParticipationTable').innerHTML = `
        <table class="participation-table">
          <thead><tr><th>Faculty / institution</th><th>People</th><th>Departments</th><th>Proposals</th><th>Calls</th></tr></thead>
          <tbody>${aggregate.institutions.map(item => `
            <tr data-org-institution="${escapeHtml(item.institution)}">
              <td>${escapeHtml(item.institution)}</td>
              <td>${fmt.format(item.n_people)}</td>
              <td>${fmt.format(item.n_departments)}</td>
              <td class="table-links" title="${escapeHtml(item.proposals.map(proposal => proposal.title).join('; '))}">${escapeHtml(compactLinks(item.proposals, 'title'))}</td>
              <td class="table-links">${escapeHtml(compactLinks(item.calls, 'name'))}</td>
            </tr>`).join('') || '<tr><td colspan="5">Geen participatie binnen deze filters.</td></tr>'}</tbody>
        </table>`;
      document.getElementById('departmentParticipationTable').innerHTML = `
        <table class="participation-table">
          <thead><tr><th>Department</th><th>Faculty / institution</th><th>People</th><th>Proposals</th><th>Calls</th></tr></thead>
          <tbody>${aggregate.departments.map(item => `
            <tr data-org-department="${escapeHtml(item.department)}" data-org-institution="${escapeHtml(item.institution)}">
              <td>${escapeHtml(item.department)}</td>
              <td>${escapeHtml(item.institution)}</td>
              <td>${fmt.format(item.n_people)}</td>
              <td class="table-links" title="${escapeHtml(item.proposals.map(proposal => proposal.title).join('; '))}">${escapeHtml(compactLinks(item.proposals, 'title'))}</td>
              <td class="table-links">${escapeHtml(compactLinks(item.calls, 'name'))}</td>
            </tr>`).join('') || '<tr><td colspan="5">Geen participatie binnen deze filters.</td></tr>'}</tbody>
        </table>`;

      const peopleIds = new Set(records.map(record => record.person_id));
      const people = DATA.persons.filter(person => peopleIds.has(person.id));
      const edges = chooseBackboneEdges(
        DATA.edges.filter(edge => peopleIds.has(edge.source) && peopleIds.has(edge.target) && passWeight(edge)),
        peopleIds
      ).map(edge => ({
        id: `organisation:${edgeKey(edge)}`,
        from: edge.source,
        to: edge.target,
        width: personEdgeWidth(edge),
        label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
        kind: 'person-edge',
        raw: edge,
      }));
      const topIds = new Set([...people].sort(sortPeopleByConnectorScore).slice(0, 20).map(person => person.id));
      setNetwork(
        people.map(person => personNode(person, topIds.has(person.id))),
        edges,
        'Organisatorische participatie',
        `${fmt.format(summary.n_people)} personen uit ${fmt.format(summary.n_institutions)} faculties / institutions en ${fmt.format(summary.n_departments)} afdelingen.`
      );
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Organisatorische participatie</h3>
        <div class="kv"><span>Callscope</span><span>${escapeHtml(callFilterLabel())}</span></div>
        <div class="kv"><span>Proposal</span><span>${escapeHtml(proposalsById.get(activeState.selectedFlagship)?.title || 'Alle voorstellen')}</span></div>
        <div class="kv"><span>Units</span><span>${fmt.format(summary.n_institutions)}</span></div>
        <div class="kv"><span>Afdelingen</span><span>${fmt.format(summary.n_departments)}</span></div>
        <div class="kv"><span>Personen</span><span>${fmt.format(summary.n_people)}</span></div>`;
    }

    function expertiseDocument(person) {
      const contexts = scopedProjectContexts(person);
      const flagships = scopedPersonFlagships(person);
      const proposalRecords = [...flagships, ...contexts].map(item => proposalsById.get(item.proposal_key || item.id) || item);
      return {
        keywords: person.expertise_keywords || '',
        summary: person.expertise_summary || '',
        proposalTitleTheme: proposalRecords.map(item => `${item.title || ''} ${item.theme || ''}`).join(' '),
        proposalSummary: proposalRecords.map(item => item.summary || '').join(' '),
        department: personDepartmentUnits(person).join(' '),
      };
    }

    function expertiseProjectLinks(person) {
      const projects = [...scopedPersonFlagships(person), ...scopedProjectContexts(person)];
      const seen = new Map();
      for (const item of projects) {
        const id = item.proposal_key || item.id;
        if (!seen.has(id)) seen.set(id, proposalsById.get(id)?.title || item.title || id);
      }
      return [...seen.values()];
    }

    function renderExpertiseOverview() {
      const query = activeState.keywordLabel || activeState.keyword;
      const candidates = DATA.persons.filter(person =>
        passCall(person) && passInstitution(person) && passDepartment(person) && passFlagshipScope(person)
      );
      if (!query) {
        document.getElementById('expertiseSummary').innerHTML = '<div class="expertise-empty">Typ een expertise, bijvoorbeeld biostatistics, AI, epidemiology, prevention of data science.</div>';
        document.getElementById('expertiseResults').innerHTML = '<div class="expertise-empty">Nog geen zoekterm ingevoerd.</div>';
        setNetwork([], [], 'Expertise zoeken', 'Typ een expertise in het zoekveld om relevante personen te tonen.');
        return;
      }

      const ranked = DashboardSearch.rank(candidates, query, expertiseDocument);
      const visible = ranked.slice(0, 50);
      const ids = new Set(visible.map(match => match.item.id));
      const edges = DATA.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && passWeight(edge)).map(edge => ({
        id: `expertise:${edgeKey(edge)}`,
        from: edge.source,
        to: edge.target,
        width: personEdgeWidth(edge),
        label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
        kind: 'person-edge',
        raw: edge,
      }));
      const institutionCounts = countValues(ranked.flatMap(match => personInstitutionUnits(match.item)));
      const departmentCounts = countValues(ranked.flatMap(match => personDepartmentUnits(match.item)));
      document.getElementById('expertiseSummary').innerHTML = `
        <div class="kv"><span>Zoekterm</span><span>${escapeHtml(query)}</span></div>
        <div class="kv"><span>Matches</span><span>${fmt.format(ranked.length)}</span></div>
        <div class="kv"><span>Met expertise</span><span>${fmt.format(ranked.filter(match => expertiseHasContent(match.item)).length)}</span></div>
        <div class="kv"><span>Getoond</span><span>${fmt.format(visible.length)} in netwerk</span></div>
        <div class="chips">${institutionCounts.slice(0, 5).map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${fmt.format(count)}</span>`).join('')}</div>
        <div class="chips">${departmentCounts.slice(0, 5).map(([name, count]) => `<span class="chip">${escapeHtml(name)}: ${fmt.format(count)}</span>`).join('')}</div>`;
      document.getElementById('expertiseResults').innerHTML = visible.map((match, index) => {
        const person = match.item;
        const projects = expertiseProjectLinks(person);
        const calls = (person.calls || []).filter(call => passesCallIds([call.id])).map(call => call.name);
        return `
          <div class="expertise-result" data-person="${escapeHtml(person.id)}">
            <div class="list-item-title">${index + 1}. ${escapeHtml(person.name)}</div>
            <div class="subtle">${escapeHtml(personInstitutionUnits(person).join('; '))} · ${escapeHtml(personDepartmentUnits(person).join('; '))}</div>
            <div class="chips">${match.reasons.map(reason => `<span class="chip">${escapeHtml(reason)}</span>`).join('')}</div>
            ${expertiseHasContent(person)
              ? `<div class="subtle expertise-summary-text"><b>${escapeHtml(person.expertise_keywords || 'Keywords not available')}</b>${person.expertise_summary ? ` · ${escapeHtml(person.expertise_summary)}` : ''}</div>`
              : '<div class="subtle expertise-summary-text"><b>Expertise not available</b> · match via department or proposal context.</div>'}
            <div class="subtle">Confidence: ${escapeHtml(person.expertise_confidence || 'Not available')} · ${escapeHtml(person.expertise_origin || 'Not available')}</div>
            <div class="subtle">Proposals: ${escapeHtml(projects.join('; ') || 'None in scope')}</div>
            <div class="subtle">Calls: ${escapeHtml(calls.join('; ') || 'None in scope')}</div>
          </div>`;
      }).join('') || '<div class="expertise-empty">Geen relevante personen gevonden binnen de actieve filters.</div>';
      setNetwork(
        visible.map(match => personNode(match.item, true)),
        edges,
        `Expertise: ${query}`,
        `${fmt.format(visible.length)} van ${fmt.format(ranked.length)} matches getoond; tekstuele relevantie met maximaal 20% netwerkboost.`
      );
      document.getElementById('selectionDetails').innerHTML = `
        <h3>Expertise zoekresultaten</h3>
        <div class="kv"><span>Zoekterm</span><span>${escapeHtml(query)}</span></div>
        <div class="kv"><span>Matches</span><span>${fmt.format(ranked.length)}</span></div>
        <div class="kv"><span>Callscope</span><span>${escapeHtml(callFilterLabel())}</span></div>
        <div class="kv"><span>Proposal</span><span>${escapeHtml(proposalsById.get(activeState.selectedFlagship)?.title || 'Alle voorstellen')}</span></div>`;
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
          label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
          kind: 'person-edge',
          raw: edge,
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
        .filter(person => passCall(person) && personDepartmentUnits(person).includes(departmentGroup) && passInstitution(person) && passKeyword(person));
      const ids = new Set(people.map(person => person.id));
      const edges = DATA.edges
        .filter(edge => ids.has(edge.source) && ids.has(edge.target) && passWeight(edge))
        .map(edge => ({
          id: edgeKey(edge),
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
          kind: 'person-edge',
          raw: edge,
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
        .filter(person => passCall(person) && personInstitutionUnits(person).includes(institution) && passDepartment(person) && passKeyword(person));
      const ids = new Set(people.map(person => person.id));
      const edges = DATA.edges
        .filter(edge => ids.has(edge.source) && ids.has(edge.target) && passWeight(edge))
        .map(edge => ({
          id: edgeKey(edge),
          from: edge.source,
          to: edge.target,
          width: personEdgeWidth(edge),
          label: filteredEdgeWeight(edge) > 2 ? String(filteredEdgeWeight(edge)) : '',
          kind: 'person-edge',
          raw: edge,
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

    function visibleConvergenceProfiles() {
      return (convergenceOverview.flagships || []).filter(profile => passesCallIds(profile.call_ids || []));
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
      bars.innerHTML = visibleConvergenceProfiles().map(profile => {
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
      const visibleIds = new Set(visibleConvergenceProfiles().map(profile => profile.id));
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
            ${convergenceOverview.ranking.filter(profile => visibleIds.has(profile.id)).map(profile => `
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
            <div class="subtle">${escapeHtml(link.partner_type || 'other/unknown')} · ${escapeHtml(campusCollaborationText(link))} · ${escapeHtml(link.source || '-')} · ${escapeHtml(link.evidence_text || link.notes || '-')}</div>
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
      const collaborationRows = campusCollaborationTypeCounts(partnerRows).map(([type, count]) => `
        <span class="chip">${escapeHtml(type)}: ${fmt.format(count)}</span>
      `).join('');
      const topPartnerRows = campusTopPartnerRows(partnerRows, 8)
        .map(row => `
          <div class="list-item" data-campus-partner="${escapeHtml(row.partner_node_id)}">
            <div class="list-item-title">${escapeHtml(row.partner_name)}</div>
            <div class="subtle">${escapeHtml(row.partner_type || 'other/unknown')} · ${escapeHtml(campusCollaborationText(row))}</div>
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
        <div class="kv"><span>Samenwerking</span><span><div class="chips">${collaborationRows || '-'}</div></span></div>
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
            <div class="subtle">${escapeHtml(row.source_type)} · ${escapeHtml(row.primary_cluster)} · ${escapeHtml(campusCollaborationText(row))} · ${escapeHtml(row.source || '-')}</div>
          </div>
        `).join('');
      const typeRows = campusPartnerTypeCounts(rows).map(([type, count]) => `${escapeHtml(type)}: ${fmt.format(count)}`).join('<br>');
      const collaborationRows = campusCollaborationTypeCounts(rows).map(([type, count]) => `${escapeHtml(type)}: ${fmt.format(count)}`).join('<br>');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(first.partner_name)}</h3>
        <div class="kv"><span>Partner type</span><span>${typeRows || escapeHtml(first.partner_type || 'other/unknown')}</span></div>
        <div class="kv"><span>Samenwerking</span><span>${collaborationRows || '-'}</span></div>
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
        <div class="kv"><span>Samenwerking</span><span>${escapeHtml(campusCollaborationText(row))}</span></div>
        ${row.collaboration_type_raw && row.collaboration_type_raw !== campusCollaborationText(row) ? `<div class="kv"><span>Type raw</span><span>${escapeHtml(row.collaboration_type_raw)}</span></div>` : ''}
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
          kind: 'campus-project-cluster-link',
          raw: edge,
      }));
      const visibleProjectIds = new Set(projects.map(project => project.project_id));
      const visibleProjectById = new Map(projects.map(project => [project.project_id, project]));
      const visiblePartnerRows = filterCampusPartnerRows(
        (campusData.partner_cluster_view || []).filter(row => visibleProjectIds.has(row.project_id))
      );
      const partnerRowsByNodeId = new Map();
      for (const row of visiblePartnerRows) {
        if (!partnerRowsByNodeId.has(row.partner_node_id)) partnerRowsByNodeId.set(row.partner_node_id, []);
        partnerRowsByNodeId.get(row.partner_node_id).push(row);
      }
      const partnerNodes = [...partnerRowsByNodeId.values()].map(rows => {
        return campusPartnerNode(rows[0], rows, shouldShowCampusPartnerLabel(rows));
      });
      const partnerEdges = visiblePartnerRows.map((row, idx) => {
        const project = visibleProjectById.get(row.project_id);
        const targetRows = partnerRowsByNodeId.get(row.partner_node_id) || [];
        const isMultiLinkTarget = isMultiLinkCampusPartner(targetRows);
        return {
          id: `campus-project-partner:${row.project_id}:${row.partner_node_id}:${row.source_link_id || idx}`,
          from: project?.id || `campus-project:${row.project_id}`,
          to: row.partner_node_id,
          width: isMultiLinkTarget ? 1.5 : 0.7,
          color: {
            color: isMultiLinkTarget ? '#8aa4c8' : '#d9e2f1',
            highlight: '#155eef',
            hover: '#155eef',
          },
          dashes: true,
          kind: 'campus-project-partner-link',
          edge_type: 'project_to_partner',
          source_type: row.source_type,
          raw: row,
        };
      });
      const edges = [...projectClusterEdges, ...partnerEdges];
      applyCampusLayout(projectNodes, clusterNodes, partnerNodes, projects, partnerRowsByNodeId);
      const filters = [
        activeState.selectedPartnerCategory && activeState.selectedPartnerCategory !== MULTI_LINK_PARTNER_FILTER ? activeState.selectedPartnerCategory : '',
        activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER ? 'Partners met meerdere links' : '',
        activeState.selectedPartnerCollaboration,
      ].filter(Boolean);
      const suffix = filters.length ? ` Filter: ${filters.join(' · ')}.` : '';
      setNetwork(
        [...projectNodes, ...clusterNodes, ...partnerNodes],
        edges,
        'HealthTech Campus ecosystem',
        `${projectNodes.length} project/programme nodes, ${clusterNodes.length} cluster nodes, ${partnerNodes.length} partner nodes, ${projectClusterEdges.length} project-to-cluster links, ${partnerEdges.length} project-to-partner links.${suffix}`
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

      const profiles = visibleConvergenceProfiles();
      const visibleIds = new Set(profiles.map(profile => profile.id));
      const nodes = convergenceOverview.network_nodes.filter(node => visibleIds.has(node.id)).map(convergenceFlagshipNode);
      const edges = convergenceOverview.network_edges
        .filter(link => visibleIds.has(link.source) && visibleIds.has(link.target))
        .filter(link => link.weight >= activeState.minWeight)
        .map(link => ({
          id: `convergence:${link.source}--${link.target}`,
          from: link.source,
          to: link.target,
          value: link.weight,
          width: 1 + Math.sqrt(link.weight),
          label: edgeLabel(link.weight),
          kind: 'convergence-flagship-link',
          raw: link,
        }));

      setNetwork(nodes, edges, 'Convergence overview', `${nodes.length} gekozen flagships, ${edges.length}/${convergenceOverview.network_edges.length} shared-person relaties getoond.`);
      markActiveFlagship('');
      const multiGroup = profiles.filter(profile => profile.n_institution_groups > 1).length;
      const strongest = [...convergenceOverview.network_edges].filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
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
        <div class="kv"><span>Flagships</span><span>${profiles.length}</span></div>
        <div class="kv"><span>Multi-instelling</span><span>${multiGroup}</span></div>
        <div class="kv"><span>Binnen 1 groep</span><span>${profiles.length - multiGroup}</span></div>
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
      let rows = partnerLinksForDisplayFlagships(displayFlagships);
      if (activeState.selectedPartnerCategory === MULTI_LINK_PARTNER_FILTER) {
        const partnerLinkCounts = new Map();
        for (const row of rows) {
          partnerLinkCounts.set(row.link.partner_id, (partnerLinkCounts.get(row.link.partner_id) || 0) + 1);
        }
        rows = rows.filter(row => partnerLinkCounts.get(row.link.partner_id) > 1);
      }
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
        kind: 'partner-flagship-link',
        raw: row.link,
        displayFlagshipId: row.displayFlagship.id,
      }));

      const filters = [
        activeState.selectedPartnerCategory ? partnerCategoryFilterLabel() : '',
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
        <div class="kv"><span>Categorie</span><span>${escapeHtml(partnerCategoryFilterLabel())}</span></div>
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
      activeState.selectedFlagship = document.getElementById('flagshipSelect').value;
      activeState.hopDepth = Number(document.getElementById('hopDepth').value || 1);
      activeState.edgeMode = 'backbone';
      refreshPersonScopeStats();
      updateCallBadge();
      renderQualityPanel();
      updateFlagshipControls();
      renderFlagshipList();
      document.getElementById('convergencePanel').hidden = true;
      document.getElementById('callsPanel').hidden = true;
      document.getElementById('organisationPanel').hidden = true;
      document.getElementById('expertisePanel').hidden = true;
      if (activeState.view === 'convergence') {
        document.getElementById('convergencePanel').hidden = false;
      } else if (activeState.view === 'calls') {
        document.getElementById('callsPanel').hidden = false;
      } else if (activeState.view === 'organisation') {
        document.getElementById('organisationPanel').hidden = false;
      } else if (activeState.view === 'expertise') {
        document.getElementById('expertisePanel').hidden = false;
      }

      if (activeState.view === 'calls') {
        renderCallsOverview();
      } else if (activeState.view === 'people') {
        renderPeopleOverview();
      } else if (activeState.view === 'organisation') {
        renderOrganisationOverview();
      } else if (activeState.view === 'expertise') {
        renderExpertiseOverview();
      } else if (activeState.view === 'convergence') {
        renderConvergenceOverview();
      } else if (activeState.view === 'campus') {
        renderCampusOverview();
      } else if (activeState.view === 'partners') {
        renderPartnerEcosystem();
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
      const scopedStats = activeState.personScopeStats.get(person.id) || { degree: 0, weightedDegree: 0 };
      const contexts = scopedProjectContexts(person);
      const topics = [...new Set(contexts.map(item => item.theme).filter(Boolean))];
      const contextRows = contexts.slice(0, 16).map(item => `
        <div class="list-item">
          <div class="list-item-title">${escapeHtml(item.title)}</div>
          <div class="subtle">${escapeHtml(item.call_name)} · ${escapeHtml(item.role || 'rol onbekend')} · ${escapeHtml(item.theme || item.project_type || 'geen thema')}</div>
          ${item.summary ? `<div class="subtle">${escapeHtml(item.summary)}</div>` : ''}
        </div>`).join('');
      document.getElementById('selectionDetails').innerHTML = `
        <h3>${escapeHtml(person.name)}</h3>
        <div class="kv"><span>Instelling</span><span>${escapeHtml(person.institution_clean || person.institution)}</span></div>
        ${person.institution_raw && person.institution_raw !== (person.institution_clean || person.institution) ? `<div class="kv"><span>Instelling ruw</span><span>${escapeHtml(person.institution_raw)}</span></div>` : ''}
        <div class="kv"><span>Afdeling</span><span>${escapeHtml(person.department_clean || person.department || '-')}</span></div>
        <div class="kv"><span>Afdeling groep</span><span>${escapeHtml(person.department_group || 'Unknown')}</span></div>
        ${person.department_raw && person.department_raw !== (person.department_clean || person.department) ? `<div class="kv"><span>Afdeling ruw</span><span>${escapeHtml(person.department_raw)}</span></div>` : ''}
        <div class="kv"><span>Rol</span><span>${escapeHtml(person.role || '-')}</span></div>
        <div class="kv"><span>Email/id</span><span>${escapeHtml(person.email || person.id)}</span></div>
        <div class="kv"><span>Degree</span><span>${fmt.format(scopedStats.degree)}</span></div>
        <div class="kv"><span>Weighted</span><span>${fmt.format(scopedStats.weightedDegree)}</span></div>
        <div class="kv"><span>Betweenness</span><span>${person.betweenness.toFixed(4)} (globaal)</span></div>
        <div class="kv"><span>Community</span><span>${person.community || '-'}</span></div>
        <div class="kv"><span>Flagships</span><span>${flagshipRows || '-'}</span></div>
        ${renderExpertiseDetails(person)}
        <div class="expertise-box">
          <h3>Projectcontext</h3>
          <div class="subtle">Afgeleid van projectdeelname; dit is geen gevalideerde persoonlijke expertise.</div>
          <div class="chips">${topics.map(topic => `<span class="chip">${escapeHtml(topic)}</span>`).join('') || '<span class="chip">Geen projectthema binnen deze callscope</span>'}</div>
          <div class="kv"><span>Projecten</span><span>${fmt.format(contexts.length)}</span></div>
          <div class="list">${contextRows || '<div class="subtle">Geen projectcontext binnen de geselecteerde calls.</div>'}</div>
          ${contexts.length > 16 ? `<div class="subtle">Eerste 16 van ${fmt.format(contexts.length)} projecten getoond.</div>` : ''}
        </div>
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
      const scopedPeople = DATA.persons.filter(passCall);
      const scopedEdges = DATA.edges.filter(edge => filteredEdgeWeight(edge) > 0);
      const partnerQuality = DATA.partner_quality || {};
      const campusQuality = campusData.quality || {};
      document.getElementById('qualityPanel').innerHTML = `
        <div><b>${escapeHtml(callFilterLabel())}</b></div>
        <div><b>${fmt.format(scopedPeople.length)}</b> personen</div>
        <div><b>${fmt.format(scopedEdges.length)}</b> relaties binnen callscope</div>
        <div><b>${fmt.format(quality.flagships)}</b> flagships</div>
        <div><b>${fmt.format(quality.placeholder_person_ids)}</b> placeholder/fallback person ids</div>
        <div><b>${fmt.format(quality.raw_institution_values)}</b> ruwe instellingwaarden → <b>${fmt.format(quality.simplified_institution_values)}</b> genormaliseerd</div>
        <div><b>${fmt.format(quality.raw_department_values || 0)}</b> ruwe afdelingen → <b>${fmt.format(quality.department_groups || 0)}</b> groepen</div>
        <div><b>${fmt.format(quality.unknown_institution_people || 0)}</b> personen met instelling Unknown; <b>${fmt.format(quality.unknown_department_people || 0)}</b> met afdeling Unknown</div>
        <div><b>${fmt.format(quality.expertise?.people_with_expertise || 0)}</b> personen met expertise; <b>${fmt.format(quality.expertise?.unmatched_records || 0)}</b> expertise-records ongematcht</div>
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
      if (['flagships', 'people', 'organisation', 'expertise', 'calls'].includes(view) && activeState.selectedPerson) {
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

    function personSearchOption(person) {
      const contexts = scopedProjectContexts(person);
      return {
        value: person.id,
        text: person.name,
        institution: person.institution_clean || person.institution,
        department: person.department_clean || person.department,
        department_group: person.department_group,
        expertise_keywords: person.expertise_keywords,
        expertise_summary: person.expertise_summary,
        project_context: contexts.map(item => `${item.title} ${item.theme} ${item.role} ${item.summary}`).join(' '),
        project_topics: [...new Set(contexts.map(item => item.theme).filter(Boolean))].join('; '),
        email: person.email,
      };
    }

    function setScopedNativeOptions(selectId, allLabel, values) {
      const select = document.getElementById(selectId);
      const current = select.value;
      select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + values
        .map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
        .join('');
      if (current && values.includes(current)) {
        select.value = current;
      } else {
        select.value = '';
        if (selectId === 'institutionFilter') activeState.selectedInstitution = '';
        if (selectId === 'departmentFilter') activeState.selectedDepartment = '';
      }
    }

    function refreshScopedControls() {
      const people = DATA.persons.filter(passCall);
      const scopedIds = new Set(people.map(person => person.id));
      if (globalSearchControl) {
        if (activeState.selectedPerson && !scopedIds.has(activeState.selectedPerson)) {
          activeState.selectedPerson = '';
          globalSearchControl.clear(true);
        }
        globalSearchControl.clearOptions();
        globalSearchControl.addOptions(people.sort((a, b) => a.name.localeCompare(b.name)).map(personSearchOption));
        globalSearchControl.refreshOptions(false);
      }
      const institutions = [...new Set(people.flatMap(personInstitutionUnits).filter(Boolean))].sort();
      const departments = [...new Set(people.flatMap(personDepartmentUnits).filter(Boolean))].sort();
      setScopedNativeOptions('institutionFilter', 'Alle instellingen', institutions);
      setScopedNativeOptions('departmentFilter', 'Alle afdelingen', departments);
      updateFlagshipControls();
      updateCallBadge();
    }

    function initControls() {
      callFilterControl = new TomSelect('#callFilter', {
        options: (DATA.calls || []).map(call => ({ value: call.id, text: call.name })),
        valueField: 'value',
        labelField: 'text',
        searchField: ['text'],
        plugins: ['remove_button'],
        maxItems: null,
        placeholder: 'Alle calls',
        onChange: values => {
          pushHistory();
          activeState.selectedCallIds = Array.isArray(values) ? values : (values ? [values] : []);
          refreshScopedControls();
          renderActiveView();
        },
      });
      if ((DATA.calls || []).length === 1) {
        callFilterControl.setValue([DATA.calls[0].id], true);
        callFilterControl.disable();
      }

      const personOptions = DATA.persons.filter(passCall).sort((a, b) => a.name.localeCompare(b.name)).map(personSearchOption);
      globalSearchControl = new TomSelect('#globalSearch', {
        options: personOptions,
        valueField: 'value',
        labelField: 'text',
        searchField: ['text', 'institution', 'department', 'department_group', 'expertise_keywords', 'expertise_summary', 'project_context', 'project_topics', 'email'],
        maxOptions: 200,
        maxItems: 1,
        create: false,
        render: {
          option: (data, escape) => `<div><strong>${escape(data.text)}</strong><div class="subtle">${escape(data.institution)} · ${escape(data.department_group || data.department || 'Unknown')} · ${escape(data.project_topics || data.expertise_keywords || data.email || '')}</div></div>`,
        },
        onType: value => {
          const nextLabel = value.trim();
          const nextKeyword = nextLabel.toLowerCase();
          if (nextKeyword !== activeState.keyword || activeState.selectedPerson) pushHistory();
          activeState.keywordLabel = nextLabel;
          activeState.keyword = nextKeyword;
          if (activeState.selectedPerson) activeState.selectedPerson = '';
          if (activeState.keyword) {
            markActiveViewTab('expertise');
          } else if (activeState.view === 'person') {
            markActiveViewTab('expertise');
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
            if (activeState.view === 'person') markActiveViewTab('expertise');
            renderActiveView();
          }
        }
      });

      updateFlagshipControls();
      refreshScopedControls();

      const partnerFilters = DATA.partner_filters || { categories: [], collaboration_types: [] };
      document.getElementById('partnerCategoryFilter').innerHTML =
        '<option value="">Alle partnercategorieen</option>' +
        `<option value="${MULTI_LINK_PARTNER_FILTER}">Partners met meerdere links</option>` +
        (partnerFilters.categories || []).map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
      document.getElementById('partnerCollaborationFilter').innerHTML =
        '<option value="">Alle samenwerkingstypen</option>' +
        (partnerFilters.collaboration_types || []).map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');

      document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setView(tab.dataset.view)));
      const toggleSidebar = () => {
        pushHistory();
        setSidebarCollapsed(!activeState.sidebarCollapsed);
        window.setTimeout(() => network.fit({ animation: { duration: 220, easingFunction: 'easeInOutQuad' } }), 80);
      };
      document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
      document.getElementById('sidebarRailToggle').addEventListener('click', toggleSidebar);
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
        document.getElementById('partnerCategoryFilter').value = '';
        document.getElementById('partnerCollaborationFilter').value = '';
        document.getElementById('minWeight').value = '1';
        document.getElementById('hopDepth').value = '1';
        if (callFilterControl && (DATA.calls || []).length > 1) callFilterControl.clear(true);
        if (globalSearchControl) globalSearchControl.clear(true);
        activeState.selectedPerson = '';
        activeState.selectedFlagship = '';
        activeState.keyword = '';
        activeState.keywordLabel = '';
        activeState.flagshipFocusPerson = '';
        activeState.selectedCallIds = [];
        activeState.selectedPartnerCategory = '';
        activeState.selectedPartnerCollaboration = '';
        refreshScopedControls();
        setSidebarCollapsed(false);
        isRestoringHistory = true;
        setView('flagships');
        isRestoringHistory = false;
        updateBackButton();
      });
      document.getElementById('flagshipSelect').addEventListener('change', event => {
        pushHistory();
        activeState.selectedFlagship = event.target.value;
        activeState.flagshipFocusPerson = '';
        if (['partners', 'people', 'organisation', 'expertise'].includes(activeState.view)) {
          renderActiveView();
          return;
        }
        if (activeState.keyword) {
          markActiveViewTab('expertise');
          renderActiveView();
          return;
        }
        setView(flagshipsById.has(activeState.selectedFlagship) || !activeState.selectedFlagship ? 'flagships' : 'people');
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
        if (activeState.view !== 'campus') markActiveViewTab('partners');
        renderActiveView();
      });
      document.getElementById('partnerCollaborationFilter').addEventListener('change', () => {
        pushHistory();
        if (activeState.view !== 'campus') markActiveViewTab('partners');
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
        const organisationDepartment = event.target.closest('[data-org-department]');
        if (organisationDepartment) {
          pushHistory();
          activeState.selectedInstitution = organisationDepartment.dataset.orgInstitution;
          activeState.selectedDepartment = organisationDepartment.dataset.orgDepartment;
          document.getElementById('institutionFilter').value = activeState.selectedInstitution;
          document.getElementById('departmentFilter').value = activeState.selectedDepartment;
          markActiveViewTab('organisation');
          renderActiveView();
          return;
        }
        const organisationInstitution = event.target.closest('[data-org-institution]');
        if (organisationInstitution) {
          pushHistory();
          activeState.selectedInstitution = organisationInstitution.dataset.orgInstitution;
          activeState.selectedDepartment = '';
          document.getElementById('institutionFilter').value = activeState.selectedInstitution;
          document.getElementById('departmentFilter').value = '';
          markActiveViewTab('organisation');
          renderActiveView();
          return;
        }
        const callItem = event.target.closest('[data-call-id]');
        if (callItem) {
          pushHistory();
          activeState.selectedCallIds = [callItem.dataset.callId];
          if (callFilterControl) callFilterControl.setValue(activeState.selectedCallIds, true);
          refreshScopedControls();
          setView('people');
          return;
        }
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
            markActiveViewTab('expertise');
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
      const selectedNode = activeState.currentNodes.find(node => node.id === id);
      if (activeState.view === 'calls' && selectedNode?.kind === 'call') {
        pushHistory();
        activeState.selectedCallIds = [selectedNode.callId];
        if (callFilterControl) callFilterControl.setValue(activeState.selectedCallIds, true);
        refreshScopedControls();
        setView('people');
      } else if (activeState.view === 'partners' && partnersById.has(id)) {
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
        if (activeState.view === 'person' || activeState.view === 'people' || activeState.view === 'connectors' || (activeState.view === 'flagships' && (activeState.selectedDepartment || activeState.selectedInstitution) && !activeState.selectedFlagship)) {
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
      const node = activeState.currentNodes.find(item => item.id === nodeId);
      if (personsById.has(nodeId)) {
        const person = personsById.get(nodeId);
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
        return;
      }

      if (activeState.view === 'campus' && node && ['campus-project', 'campus-cluster', 'campus-partner'].includes(node.kind)) {
        if (node.kind === 'campus-partner') {
          const rows = campusPartnerRowsByNodeId.get(nodeId) || [];
          if (rows.length) network.body.data.nodes.update({ id: nodeId, label: rows[0].partner_name });
        }
        const tooltipHtml = renderCampusTooltipContent(nodeId);
        if (tooltipHtml) showNetworkTooltip(tooltipHtml, params.pointer?.DOM);
      }
    });

    network.on('blurNode', params => {
      const nodeId = params.node;
      if (personsById.has(nodeId)) {
        restorePersonNode(nodeId);
        hideNetworkTooltip();
        return;
      }
      if (activeState.view === 'campus') {
        restoreCurrentNode(nodeId);
        hideNetworkTooltip();
      }
    });

    network.on('hoverEdge', params => {
      const edge = activeState.currentEdges.find(item => item.id === params.edge);
      const tooltipHtml = renderEdgeTooltipContent(edge);
      if (tooltipHtml) showNetworkTooltip(tooltipHtml, params.pointer?.DOM);
    });

    network.on('blurEdge', () => {
      hideNetworkTooltip();
    });

    renderFlagshipList();
    renderQualityPanel();
    initControls();
    renderFlagshipOverview();
