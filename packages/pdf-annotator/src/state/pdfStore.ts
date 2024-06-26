import { Origin } from '@recogito/text-annotator';
import type { 
  TextAnnotation, 
  TextAnnotationStore, 
  TextAnnotationTarget, 
  TextSelector
} from '@recogito/text-annotator';
import type { 
  PDFAnnotation, 
  PDFAnnotationTarget, 
  PDFSelector 
} from '../PDFAnnotation';

/**
 * Revives the given annotation target, if needed.
 * 
 * - if there is a valid offsetReference element, it will reconstruct the PDF page number if needed.
 * - vice versa, if there is no offsetReference, but a pageNumber, it will add in the offsetReference element.
 * 
 * Targets that have neither a pageNumber nor an offsetReference shouldn't be possible. (Annotations
 * created by the user will always have an offsetReference, annotations coming from the backend or 
 * realtime channel will always have a page number).
 */
const reviveTarget = (target: PDFAnnotationTarget | TextAnnotationTarget): PDFAnnotationTarget => ({
  ...target,
  selector: target.selector.map(reviveSelector)
});

const reviveSelector = (selector: PDFSelector | TextSelector): PDFSelector => {
  const hasValidOffsetReference = 
    'offsetReference' in selector && 
    selector.offsetReference instanceof HTMLElement;

  if (hasValidOffsetReference) {
    if ('pageNumber' in selector) {
      // Already a PDF selector - doesn't need reviving
      return selector as PDFSelector;
    } else {
      // No pageNumber, but offsetReference element -> crosswalk
      const { offsetReference } = selector;
      const pageNumber = parseInt(offsetReference.dataset.pageNumber);
    
      return {
        ...selector,
        pageNumber 
      };
    }
  } else if ('pageNumber' in selector) {
    const { pageNumber } = selector;
    const offsetReference: HTMLElement = document.querySelector(`.page[data-page-number="${pageNumber}"]`);

    return {
      ...selector,
      offsetReference
    } as PDFSelector;
  } else { 
    // Has neither offsetReference - shouldn't happen
    console.warn('Invalid PDF selector', selector);
    return selector as PDFSelector;
  }
}

/** Helper: revives the target of the given annotation, if needed **/
const revive = (a: PDFAnnotation | TextAnnotation): PDFAnnotation => ({
  ...a,
  target: reviveTarget(a.target)
});

interface PDFAnnotationStore extends TextAnnotationStore {

  onLazyRender(page: number): void;

}

/**
 * The PDF plugin intercepts a few methods on the standard
 * TextAnnotationStore and applies PDF-specific target-reviving.
 */
export const createPDFStore = (store: TextAnnotationStore): PDFAnnotationStore => {

  // Keep track of annotations per page because of PDF.js lazy rendering
  const rendered: Map<number, PDFAnnotation[]> = new Map();

  const upsertRenderedAnnotation = (a: PDFAnnotation) => {
    const pages = a.target.selector.map((s:PDFSelector) => s.pageNumber);

    pages.forEach(p => {
      const current = rendered.get(p) || [];
      const next = [
        ...current.filter(annotation => annotation.id !== a.id),
        a
      ]

      rendered.set(p, next);
    });  
  }

  const updateRenderedTarget = (t: PDFAnnotationTarget) => {
    const pages = t.selector.map((s:PDFSelector) => s.pageNumber);

    pages.forEach(p => {
      const current = rendered.get(p) || [];
      const next = current.map(a => a.id === t.annotation ? {
        ...a,
        target: t
      } : a);

      rendered.set(p, next);
    });      
  }

  // Intercept and monkey-patch API where needed
  const _addAnnotation = store.addAnnotation;
  store.addAnnotation = (annotation: PDFAnnotation | TextAnnotation, origin = Origin.LOCAL) => {
    const revived = revive(annotation);

    const success = _addAnnotation(revived, origin);

    upsertRenderedAnnotation(revived);

    return success;
  }

  const _bulkAddAnnotation = store.bulkAddAnnotation;
  store.bulkAddAnnotation = (
    annotations: PDFAnnotation[], 
    replace: boolean,
    origin = Origin.LOCAL
  ) => {
    const revived = annotations.map(revive);

    const failed = _bulkAddAnnotation(revived, replace, origin) as PDFAnnotation[];
    revived.forEach(upsertRenderedAnnotation);

    return failed;
  }

  const _updateAnnotation = store.updateAnnotation;
  store.updateAnnotation = (annotation: PDFAnnotation | TextAnnotation, origin = Origin.LOCAL) => {
    const revived = revive(annotation);
    _updateAnnotation(revived, origin);
    upsertRenderedAnnotation(revived);
  }

  const _updateTarget = store.updateTarget;
  store.updateTarget = (target: PDFAnnotationTarget | TextAnnotationTarget, origin = Origin.LOCAL) => {
    const revived = reviveTarget(target);
    _updateTarget(revived, origin);
    updateRenderedTarget(revived);
  }

  // Callback method for when a new page gets rendered by PDF.js
  const onLazyRender = (page: number) => {    
    // Get annotations for this page and +2 in both directions
    const pages = [page - 2, page - 1, page, page + 1, page + 2].filter(n => n >= 0);
    
    const toRender = pages.reduce<PDFAnnotation[]>((annotations, page) => (
      [...annotations, ...(rendered.get(page) || [])]
    ), []).map(({ id }) => store.getAnnotation(id));

    if (toRender.length > 0)
      // Attempt to update the unrendered annotations in the store      
      store.bulkUpsertAnnotations(toRender, Origin.REMOTE);
  }  

  return {
    ...store,
    onLazyRender
  };

}