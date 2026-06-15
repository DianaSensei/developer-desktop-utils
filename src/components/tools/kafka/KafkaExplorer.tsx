import { Server } from 'lucide-react';
import { LeftPanel } from './LeftPanel';
import { TopicView } from './TopicView';
import { GroupView } from './GroupView';
import { useKafkaState } from './useKafkaState';

export function KafkaExplorer() {
  const {
    selectedBrokerId,
    setSelectedBrokerId,
    selectedTopic,
    setSelectedTopic,
    selectedGroup,
    setSelectedGroup,
    selectedTab,
    setSelectedTab,
    refreshKey,
    refresh,
  } = useKafkaState();

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left panel */}
      <div className="w-64 shrink-0 border-r flex flex-col h-full overflow-hidden">
        <LeftPanel
          selectedBrokerId={selectedBrokerId}
          onSelectBroker={setSelectedBrokerId}
          selectedTopic={selectedTopic}
          onSelectTopic={setSelectedTopic}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          refreshKey={refreshKey}
        />
      </div>

      {/* Right panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {!selectedBrokerId ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Server className="w-8 h-8 opacity-30" />
            <p className="text-sm">Add a broker to get started</p>
          </div>
        ) : selectedTopic ? (
          <TopicView
            brokerId={selectedBrokerId}
            topic={selectedTopic}
            refreshKey={refreshKey}
            selectedTab={selectedTab}
            onSelectTab={setSelectedTab}
            onRefresh={refresh}
            onSelectGroup={setSelectedGroup}
          />
        ) : selectedGroup ? (
          <GroupView
            brokerId={selectedBrokerId}
            groupId={selectedGroup}
            refreshKey={refreshKey}
            onRefresh={refresh}
            onSelectTopic={setSelectedTopic}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">Select a topic or group from the left panel</p>
          </div>
        )}
      </div>
    </div>
  );
}
