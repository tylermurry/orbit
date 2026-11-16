import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Dialog, Flex, IconButton, Text } from '@radix-ui/themes';
import { ChevronLeftIcon, ChevronRightIcon, Cross2Icon } from '@radix-ui/react-icons';
import { formatDateTime } from '../lib/format';
import type { Walkthrough, WalkthroughReport } from '../lib/walkthrough';
import { useHost } from '../state/context';

export function TestWalkthrough({ report, testId, testName }: { report: WalkthroughReport | null; testId: string; testName: string }) {
  const walkthrough = report?.tests.get(testId);
  if (!report || !walkthrough) return <span className="bh-test-name">{testName}</span>;

  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button type="button" className="bh-test-name bh-walkthrough-link" aria-label={`View walkthrough for ${testName}`}>
          {testName}
        </button>
      </Dialog.Trigger>
      <Dialog.Content width="fit-content" maxWidth="100%" aria-describedby={undefined} onClick={(event) => event.stopPropagation()}>
        <Flex className="walkthrough-header" justify="between" align="start" gap="4">
          <div>
            <Dialog.Title mb="1">{testName}</Dialog.Title>
            {walkthrough.recordedAt && <Text as="div" size="1" color="gray">Recorded {formatDateTime(walkthrough.recordedAt)}</Text>}
          </div>
          <Dialog.Close>
            <IconButton size="2" variant="ghost" color="gray" aria-label="Close walkthrough"><Cross2Icon /></IconButton>
          </Dialog.Close>
        </Flex>
        <WalkthroughSteps key={report.sha} walkthrough={walkthrough} manifest={report.path} />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function WalkthroughSteps({ walkthrough, manifest }: { walkthrough: Walkthrough; manifest: string }) {
  const host = useHost();
  const [index, setIndex] = useState(0);
  const [displayed, setDisplayed] = useState<{ index: number; url?: string | null; aspectRatio: number }>({
    index: 0,
    aspectRatio: 16 / 9,
  });
  const imageUrls = useRef(new Set<string>());
  const expectationsPanel = useRef<HTMLElement>(null);
  const { steps } = walkthrough;
  const step = steps[displayed.index]!;
  const nextImage = steps[index]!.image;
  const move = (by: number) => setIndex((current) => Math.max(0, Math.min(steps.length - 1, current + by)));

  useEffect(() => {
    const urls = imageUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!nextImage) {
      setDisplayed((previous) => ({ ...previous, index, url: null }));
      return;
    }

    let active = true;
    let pendingUrl: string | undefined;
    const urls = imageUrls.current;
    // Keep the current step on screen until the requested screenshot can be painted.
    const screenshot = walkthrough.readImage?.(nextImage) ?? host.readWalkthroughImage(manifest, nextImage);
    void screenshot.then(async (bytes) => {
      if (!active) return;
      const type = /\.png$/i.test(nextImage) ? 'image/png' : /\.webp$/i.test(nextImage) ? 'image/webp' : 'image/jpeg';
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      pendingUrl = url;
      urls.add(url);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!active) return;
      pendingUrl = undefined;
      setDisplayed({ index, url, aspectRatio: image.naturalWidth / image.naturalHeight });
    }).catch(() => {
      if (!active) return;
      if (pendingUrl) {
        URL.revokeObjectURL(pendingUrl);
        urls.delete(pendingUrl);
        pendingUrl = undefined;
      }
      setDisplayed((previous) => ({ ...previous, index, url: null }));
    });
    return () => {
      active = false;
      if (pendingUrl && urls.delete(pendingUrl)) URL.revokeObjectURL(pendingUrl);
    };
  }, [host, manifest, index, nextImage, walkthrough.readImage]);

  useEffect(() => {
    const urls = imageUrls.current;
    const url = displayed.url;
    return () => {
      if (url && urls.delete(url)) URL.revokeObjectURL(url);
    };
  }, [displayed.url]);

  useEffect(() => {
    // Listen while the dialog is mounted, including when focus is on its close button.
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        const by = event.key === 'ArrowLeft' ? -1 : 1;
        setIndex((current) => Math.max(0, Math.min(steps.length - 1, current + by)));
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [steps.length]);

  useEffect(() => {
    if (expectationsPanel.current) expectationsPanel.current.scrollTop = 0;
  }, [displayed.index]);

  return (
    <Flex
      className="walkthrough-body"
      direction="column"
      gap="3"
      mt="4"
      style={{ '--walkthrough-aspect-ratio': displayed.aspectRatio } as CSSProperties}
    >
      <div className="walkthrough-step" aria-live="polite">
        {steps.some((item) => item.description) && <Text as="p" className="walkthrough-caption" size="5" weight="medium">{step.description}</Text>}
        <div className="walkthrough-content">
          <section ref={expectationsPanel} className="walkthrough-expectations" aria-label="Expectations" tabIndex={0}>
            <Text as="div" size="2" weight="medium">Expectations</Text>
            {step.expectations?.length ? (
              <ul>
                {step.expectations.map((expectation, position) => <li key={position}>{expectation}</li>)}
              </ul>
            ) : <Text as="div" size="2" color="gray">No expectations recorded for this step</Text>}
          </section>
          <div className="walkthrough-preview">
            {displayed.url
              ? <img src={displayed.url} alt={`Screenshot for step ${displayed.index + 1}`} />
              : <Text color="gray" size="2">{step.image && displayed.url === undefined ? 'Loading screenshot…' : 'No image found for this step'}</Text>}
          </div>
        </div>
      </div>
      {steps.length > 1 && (
        <Flex align="center" justify="between" gap="2">
          <Button variant="soft" color="gray" aria-keyshortcuts="ArrowLeft" onClick={() => move(-1)} disabled={index === 0}><ChevronLeftIcon /> Previous</Button>
          <Text size="2" color="gray" role="status">{displayed.index + 1} of {steps.length}</Text>
          <Button variant="soft" aria-keyshortcuts="ArrowRight" onClick={() => move(1)} disabled={index === steps.length - 1}>Next <ChevronRightIcon /></Button>
        </Flex>
      )}
    </Flex>
  );
}

