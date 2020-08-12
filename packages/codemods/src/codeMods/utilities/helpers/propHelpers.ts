import {
  ts,
  Node,
  SyntaxKind,
  JsxOpeningElement,
  JsxSelfClosingElement,
  VariableDeclarationKind,
  CodeBlockWriter,
  JsxAttributeLike,
  Block,
  VariableStatement,
} from 'ts-morph';
import { ValueMap, SpreadPropInStatement } from '../../types';
import { Maybe } from '../../../helpers/maybe';
import { getParent } from 'office-ui-fabric-react/lib/Utilities';

/* Helper function to rename a prop if in a spread operator.  */
export function renamePropInSpread(
  element: JsxOpeningElement | JsxSelfClosingElement,
  toRename: string,
  replacementName: string,
  changeValueMap?: ValueMap<string>,
  replacementValue?: string,
) {
  /* Step 1: Figure out which attribute contains the spread prop. */
  const allAttributes = element.getAttributes();
  allAttributes.forEach(attribute => {
    if (!element.getAttribute(replacementName)) {
      if (attribute.getKind() === SyntaxKind.JsxSpreadAttribute) {
        const firstIdentifier = attribute.getFirstChildByKind(SyntaxKind.Identifier);
        const propertyAccess = attribute.getFirstChildByKind(SyntaxKind.PropertyAccessExpression);
        if (!attribute || (!firstIdentifier && !propertyAccess)) {
          return;
        }
        const spreadIsIdentifier = firstIdentifier !== undefined;
        /* Verify this attribute contains the name of our desired prop. */
        if (spreadContains(toRename, spreadIsIdentifier, attribute)) {
          /* Step 3: Create names for your new potential objects. */
          const propSpreadName = spreadIsIdentifier ? firstIdentifier!.getText() : propertyAccess!.getText();
          let newSpreadName = '__migProps';
          const newMapName = '__migEnumMap';
          /* Metadata in case we need to reacquire the current element (AST modification). */
          let newJSXFlag = false;
          const elementType = element.getKind();

          /* Step 4: Get the container node who is the direct child of the closest SyntaxKind.Block.
             If we need to insert auxiliary variables, we'll insert them before this node. */
          let blockContainer = getBlockContainer(element);
          if (blockContainer === undefined) {
            /* In the case there was NO code block, the following function will create one for you.
               If successful, initialize the newJSXFlag because you'll need to reaquire the spread element. */
            const containerMaybe = createBlockContainer(element);
            if (containerMaybe.something) {
              blockContainer = containerMaybe.value;
              newJSXFlag = true;
            } else {
              // eslint-disable-next-line no-throw-literal
              throw 'attempt to create a new block around prop failed.';
            }
          }

          /* Step 5: Get the parent of BLOCKCONTAINER so that we can insert our own variable statements. */
          const parentContainer = blockContainer!.getParentIfKind(SyntaxKind.Block);
          if (parentContainer === undefined) {
            // eslint-disable-next-line no-throw-literal
            throw 'unable to get parent container from block';
          }

          /* Step 7: Look to see if the prop we're looking for exists already. Manually
           deconstruct it from the spread prop if not. */
          const variableStatementWithSpreadProp = parentContainer.getVariableStatement(
            (declaration: VariableStatement) => {
              const elem = declaration.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
              return (
                elem !== undefined &&
                (elem.getText().includes(`...${propSpreadName}`) ||
                  elem.getText().includes(`...${newSpreadName}`) ||
                  elem.getText().includes(propSpreadName))
              );
            },
          );

          /* If a variable statement with the spread prop in question exists, try and use it.  */
          if (variableStatementWithSpreadProp) {
            /* Depending on where this spread prop was in the statement, there are different things we need to do. */
            switch (locateSpreadPropInStatement(variableStatementWithSpreadProp, propSpreadName, newSpreadName)) {
              case SpreadPropInStatement.PropLeft: {
                /* If the spread prop was on the left with no '...' in front of it, try and create a new variable
                   statement, deconstructing this spread prop. */
                if (!propAlreadyExists(parentContainer, toRename)) {
                  parentContainer.insertVariableStatement(
                    insertIndex,
                    createDeconstructedProp(newSpreadName, toRename, propSpreadName),
                  );
                } else {
                  newSpreadName = propSpreadName;
                }
                break;
              }
              case SpreadPropInStatement.SpreadPropLeft:
              case SpreadPropInStatement.PropRight: {
                /* If the prop is on the right or it's in spread form on the left,
                   we can try and insert out TORENAME prop into its detruction. */
                newSpreadName = propSpreadName;
                if (!propAlreadyExists(parentContainer, toRename)) {
                  tryInsertExistingDecomposedProp(toRename, variableStatementWithSpreadProp);
                }
                break;
              }
              case SpreadPropInStatement.NotFound:
              default: {
                /* We shoulnd't make any intermediate steps if we coulnd't find the spread prop. */
                newSpreadName = propSpreadName;
                break;
              }
            }
          } else {
            if (!propAlreadyExists(parentContainer, toRename)) {
              parentContainer.insertVariableStatement(
                insertIndex,
                createDeconstructedProp(newSpreadName, toRename, propSpreadName),
              );
            } else {
              newSpreadName = propSpreadName;
            }
          }

          /* Step 7: Look to see if the prop we're looking for exists already. Manually
           deconstruct it from the spread prop if not. */
          const variableStatementWithSpreadProp = parentContainer.getVariableStatement(
            (declaration: VariableStatement) => {
              const elem = declaration.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
              return (
                elem !== undefined &&
                (elem.getText().includes(`...${propSpreadName}`) || elem.getText().includes(`...${newSpreadName}`))
              );
            },
          );
          /* If a variable statement with the spread prop in question exists, try and use it.  */
          if (variableStatementWithSpreadProp) {
            /* Get the name of the deconstructed object, becuase we'll try and reuse it. */
            const existingDecomposedPropName = Maybe(
              variableStatementWithSpreadProp.getFirstDescendantByKind(SyntaxKind.DotDotDotToken),
            )
              .then(val => val.getParent())
              .then(val => val.getFirstChildByKind(SyntaxKind.Identifier))
              .then(val => val.getText());
            if (existingDecomposedPropName.something) {
              newSpreadName = existingDecomposedPropName.value;
            }
            if (!propAlreadyExists(parentContainer, toRename)) {
              tryInsertExistingDecomposedProp(toRename, variableStatementWithSpreadProp);
            }
          } else {
            /* If we could not find a variable statement with our spread prop in it, make one. */
            parentContainer.insertVariableStatement(
              insertIndex,
              createDeconstructedProp(newSpreadName, toRename, propSpreadName),
            );
          }

          /* Step 10: Replace the props in the component with your new ones! */
          if (
            element.getAttributes().some(attr => {
              if (attr.getKind() === SyntaxKind.JsxSpreadAttribute) {
                const child = attr.getChildAtIndex(2);
                if (child) {
                  return child.getText() === newSpreadName;
                }
              }
              return false;
            })
          ) {
            /* Check to make sure that you're not renaming attrToRename to an extant prop. */
            if (attrToRename.getChildAtIndex(2)!.getText() !== newSpreadName) {
              attrToRename.remove(); // Replace old spread name.
            }
          } else {
            attrToRename.replaceWithText(`{...${newSpreadName}}`); // Replace old spread name.
          }
          element.addAttribute({
            name: replacementName,
            initializer: changeValueMap
              ? `{${newMapName}[${toRename}]}`
              : replacementValue
              ? `{${replacementValue}}`
              : `{${toRename}}`,
          }); // Add the updated prop name and set its value.
        }

        /* Step 9: Handle any last auxiliary cases (i.e. component rendered with no body). */
        let attrToRename = attribute;
        /* attribute is an iterator variable in the forEach function. */
        if (newJSXFlag) {
          const newSpreadProp = Maybe(blockContainer!.getFirstDescendantByKind(SyntaxKind.JsxSpreadAttribute));
          const newJSXElem = Maybe(
            blockContainer!.getFirstDescendantByKind(
              elementType as SyntaxKind.JsxOpeningElement | SyntaxKind.JsxSelfClosingElement,
            ),
          );
          if (newSpreadProp.something && newJSXElem.something) {
            attrToRename = newSpreadProp.value;
            element = newJSXElem.value;
          }
        }

        /* Step 10: Replace the props in the component with your new ones! */
        //console.log(newSpreadName);
        if (
          element.getAttributes().some(attr => {
            if (attr.getKind() === SyntaxKind.JsxSpreadAttribute) {
              const child = attr.getChildAtIndex(2);
              if (child) {
                return child.getText() === newSpreadName;
              }
            }
            return false;
          })
        ) {
          if (attrToRename.getChildAtIndex(2)!.getText() !== newSpreadName) {
            attrToRename.remove(); // Replace old spread name.
          }
        } else {
          attrToRename.replaceWithText(`{...${newSpreadName}}`); // Replace old spread name.
        }
        if (!element.getAttribute(replacementName)) {
          element.addAttribute({
            name: replacementName,
            initializer: changeValueMap
              ? `{${newMapName}[${toRename}]}`
              : replacementValue
              ? `{${replacementValue}}`
              : `{${toRename}}`,
          }); // Add the updated prop name and set its value.
        } else {
          console.log('caught attempted repeat');
        }
      }
    }
  });
}

/* Helper function that identifies the location of a spread prop within
   a variable statement and returns an enum member to facilitate case handling.
   MIGRATIONPROPNAME is custom made for each component, so if it's found, we
   know we've already created a variable statement here before. */
function locateSpreadPropInStatement(
  statement: VariableStatement,
  propNameFound: string,
  migrationPropName: string,
): SpreadPropInStatement {
  const varDeclaration = statement.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
  if (varDeclaration) {
    const leftChild = varDeclaration.getChildAtIndex(0);
    const rightChild = varDeclaration.getChildAtIndex(2); // Index 1 is '='.
    if (rightChild && propNameFound.includes(rightChild.getText())) {
      return SpreadPropInStatement.PropRight;
    }
    if (leftChild) {
      const leftSideObject = leftChild.getFirstChild(child => {
        return propNameFound.includes(child.getText()) || child.getText().includes(migrationPropName);
      });
      if (leftSideObject) {
        if (leftSideObject.getText().includes('...')) {
          return SpreadPropInStatement.SpreadPropLeft;
        } else {
          return SpreadPropInStatement.PropLeft;
        }
      }
    }
  }
  return SpreadPropInStatement.NotFound;
}

/* Helper that identifies whether the prop TORENAME exists in a variable
   declaration. If it does, the caller may not need to create a new variable
   declatation statement. */
function propAlreadyExists(parentContainer: Block, toRename: string): boolean {
  if (parentContainer.getVariableStatement(toRename)) {
    return true;
  } else {
    const statements = parentContainer.getVariableStatements();
    return statements.some(statement => {
      const declaration = statement.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
      return declaration && declaration.getText().includes(toRename);
    });
  }
}

/* Looks to see if the spread prop in question already exists, and if so
   attempts to insert the desired prop into its decomposition. Returns TRUE
   if it successfully inserts OLDPROP into the spread deconstruction, false if otherwise. */
function tryInsertExistingDecomposedProp(oldProp: string, statement: VariableStatement) {
  const decompObject = statement.getFirstDescendantByKind(SyntaxKind.ObjectBindingPattern);
  if (decompObject) {
    let objectText = decompObject.getText();
    objectText = objectText.substr(0, 1) + ` ${oldProp},` + objectText.substr(1);
    decompObject.replaceWithText(objectText);
    return true;
  }
  return false;
}

/* Creates and returns a variable statement to the user's specification. KIND determines how
   the variable is declared (i.e. const), and the name and value (which must be in string form)
   will be inserted following. */
function createAuxiliaryVariable(kind: VariableDeclarationKind, varName: string, varValue: string) {
  return {
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: varName,
        initializer: varValue,
      },
    ],
  };
}

/* Creates and returns a variable statement deconstructing the spread prop into
   both a new spread prop and the desired prop to rename. */
function createDeconstructedProp(newSpreadPropName: string, toRename: string, oldSpreadPropName: string) {
  return {
    declarationKind: VariableDeclarationKind.Const,
    declarations: [
      {
        name: `{${toRename}, ...${newSpreadPropName}}`,
        initializer: oldSpreadPropName,
      },
    ],
  };
}

/* Helper function that returns TRUE if the supplied spread object
   contains the prop we're looking for. Else returns FALSE. */
function spreadContains(oldPropName: string, spreadIsIdentifier: boolean, spreadProp: JsxAttributeLike): boolean {
  const element = spreadIsIdentifier
    ? spreadProp.getFirstChildByKind(SyntaxKind.Identifier)
    : spreadProp.getFirstChildByKind(SyntaxKind.PropertyAccessExpression);
  return (
    element !== undefined &&
    element
      .getType()!
      .getProperties()
      .some(name => {
        return name.getName() === oldPropName;
      })
  );
}

/* This function is called if no block container could be found,
   meaning that the prop is in a function without a block for code,
   indicating a big-arrow function with no body. We will insert that
   block and then continue. */
function createBlockContainer(element: JsxOpeningElement | JsxSelfClosingElement) {
  return Maybe(
    element.getFirstAncestor(ans => {
      return ans.getKind() === SyntaxKind.ArrowFunction;
    }),
  )
    .then(ans => {
      const oldBody = element.getText();
      const writer = new CodeBlockWriter();
      writer.block(() => {
        writer.write('return ');
        writer.write(oldBody);
      });
      element.replaceWithText(writer.toString());
      return ans.getFirstChildByKind(SyntaxKind.Block);
    })
    .then(block => {
      return block.getFirstDescendant(child => {
        return child.getKind() === SyntaxKind.ReturnStatement;
      });
    });
}

/* Gets the parent that is a direct descendant of a block
   which should allow for better inserting */
function getBlockContainer(node: Node<ts.Node>) {
  return node.getFirstAncestor(ans => {
    const ansPar = ans.getParent();
    return ansPar?.getKind() === SyntaxKind.Block;
  });
}
